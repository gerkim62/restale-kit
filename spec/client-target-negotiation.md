# Client Target Negotiation

**Status:** Implemented  
**Date:** 2026-07-18

---

## Goal

Let the client declare which signal target it wants at connection time via a query parameter.
The server reads it, filters frames to that target only (saving bandwidth), and echoes negotiation
metadata in response headers. If the requested target is not supported by the server channel, the
server terminates the connection with a typed reason on the existing `revoke` event, so the client
never retries blindly.

This is an improvement to existing behavior, not an additive opt-in feature. The `target` field
already exists on both sides; this wires them together over the wire.

---

## Current State

| Layer | What happens today |
|---|---|
| Server | `target` set in `SSEChannelOptions` by the developer. `processTargetSignals()` stamps untagged signals. `X-ReStale-Target` echoed in the SSE response headers (set by transport adapters). |
| Client | `ClientOptions.target` exists but is **never sent to the server**. Used only locally in adapter callbacks to skip non-matching signals. |
| Wire | No query param, no negotiation, no filtering. Every frame goes to every client regardless of its target. |
| Transport | `SSEInvalidatorClient` uses **`sse.js`** (`sse-client.ts`). `sse.js` enables inspecting handshake HTTP status codes (`nonRetryableStatuses`, `onRejected`, `Retry-After`) while handling standard SSE event streams. Rejections sent via server SSE event frames (e.g. `revoke`) are also handled directly by `wireInvalidateListener`. |

---

## Proposed Wire Contract

### 1. Client sends target in the request query string

```text
GET /sse?__restale_cid__=abc123&__restale_target__=swr
```

- Parameter name: `__restale_target__`
- Single value only (not an array). One connection = one target.
- Required when connecting to a channel configured with multiple supported targets. If absent on a multi-target channel, the server rejects the connection with an `unsupported-target` revocation frame (`reason: 'unsupported-target'`). On single-target channels, defaults to the channel's sole target if absent.
- The client sends whatever is in `ClientOptions.target`. Framework adapters (`useSwrAdapter`,
  `useTanstackQueryAdapter`) already default `target` — they will now also append the param
  automatically.

### 2. Server responds with two headers

On a successful SSE response:

```text
X-ReStale-Target: swr
X-ReStale-Supported: tanstack-query, swr
```

| Header | Value | Meaning |
|---|---|---|
| `X-ReStale-Target` | The *single* target being returned | Already exists; semantics unchanged |
| `X-ReStale-Supported` | Comma-separated list of all targets the channel supports | New |

Both headers are informational for developers / devtools only. Native `EventSource` cannot read
response headers from JS, so the client never parses these at runtime.

### 3. Unsupported target: extend the existing `revoke` event (no new event type)

When the client requests `?__restale_target__=rtk-query` but the server channel is configured
with `target: ['tanstack-query', 'swr']`, the server:

1. Accepts the connection (200 OK, SSE headers written) — this is unavoidable with `EventSource`;
   the server can't withhold the 200 until negotiation completes, since headers must be flushed
   before the developer's channel logic runs. See **Known limitation** below.
2. Immediately emits a `revoke` event frame with a structured reason:
   ```text
   event: revoke
   data: {"reason":"unsupported-target","requested":"rtk-query","supported":["tanstack-query","swr"]}
   ```
3. Closes the stream.

**Why reuse `revoke` instead of adding a `reject` event:**
The client's existing `wireInvalidateListener` already handles `revoke` by setting
`this.revoked = true`, tearing down, and suppressing all retry paths (both the native
auto-reconnect branch and the JS backoff branch in `onerror` both gate on `!this.revoked`). An
unsupported-target rejection needs exactly that behavior — accept once, don't retry. Adding a
parallel `reject` event would duplicate the entire suppress-retry mechanism (new event map entry,
new status union member, new callback, new log lines) for no behavioral difference. Instead,
`revoke` gets a `reason` field distinguishing *why* the client was revoked:

- `reason: 'session-expired'` / `'logout'` / `'banned'` (existing use cases, informal today —
  formalize as needed)
- `reason: 'unsupported-target'` (new)

Consumers that care about *why* can branch on `detail.reason`; consumers that don't can keep
treating every `revoke` identically, exactly as today.

**Known limitation — `open` then immediate `revoke`:**
Because native `EventSource` fires `onopen` on the raw 200 response (before any frame is read —
`sse-client.ts` ~line 238, which also resolves `connectPromise`), a rejected connection will
always show `open` status for one tick before the `revoke` arrives. This is not fixable with
`EventSource` as the transport; it should be documented as expected behavior, not treated as a
bug. Any consumer that triggers side effects from `onOpen` (e.g. an initial fetch in
`useReStale`) should treat `revoke` as authoritative if it arrives immediately after.

### 4. Server-side filtering

When a client-requested target is accepted, the server filters outgoing frames to that target only:

- Signals that carry an explicit `target` field not matching the requested target are **dropped**.
- Signals with no `target` field are stamped with the requested target via the existing
  `processTargetSignals()` — **not dropped**.
- Batched signals (`InvalidateSignal[]`) are filtered per item; if all items are dropped the frame
  is not emitted.

This filtering happens inside `channel.invalidate()`, after `processTargetSignals()` already runs.
No changes to `processTargetSignals()` are needed.

---

## Changes Required

### `utils/constants.ts`

- Add `RESTALE_TARGET_PARAM: '__restale_target__'` to `PROTOCOL_CONSTANTS`.
- Add `X-ReStale-Supported` to a new `SSE_RESPONSE_HEADERS` record (or extend `SSE_HEADERS`).
- No new `SSE_EVENTS` entry — `revoke` already exists.

### `types/protocol.ts`

- Extend whatever type/shape backs the `revoke` payload today with an optional `reason` field
  (string) and, when `reason === 'unsupported-target'`, optional `requested` / `supported` fields.
  If the revoke payload is currently untyped/ad hoc JSON, add a minimal discriminated shape here
  instead of leaving it implicit.

### `server/core/framing.ts`

- Extend the existing revoke-frame formatter (or add a thin wrapper around it) to accept an
  optional structured reason payload:
  ```ts
  formatRevokeFrame(reason?: string, details?: { requested: string; supported: string[] })
  ```
  Producing:
  ```
  event: revoke
  data: {"reason":"unsupported-target","requested":"<val>","supported":["..."]}
  ```
- Do **not** add a separate `formatRejectFrame`.

### `server/transport-utils.ts`

- Add `extractRequestedTarget(searchParams: URLSearchParams): string | undefined`.
  Reads `__restale_target__`, validates it is a known `SignalTarget` value, returns `undefined`
  if absent. Does **not** throw — absence means "no preference, send everything."

### `server/core/channel.ts` — `SSEChannelOptions` & `createSSEChannel`

New option:
```ts
interface SSEChannelOptions {
  // ...existing...
  /** The single target requested by this client, extracted from the request query param. */
  requestedTarget?: SignalTarget
}
```

**On stream start** (inside `ReadableStream.start`):
- If `requestedTarget` is set, check it against `options.target` (the server's configured target
  or target array).
- If it is **not** in the supported set: emit a `revoke` frame with
  `reason: 'unsupported-target'`, then call `closeInternal()`.
  Log: `[WARN][createSSEChannel] Rejected connection: requested target "<x>" is not supported.
  Supported: [...]. connectionId: <id>.`
- If it **is** supported: store `requestedTarget` internally.

**In `invalidate()`**, after `processTargetSignals()` runs:
- If `requestedTarget` is set, filter the effective signal:
  - For a single signal: if `signal.target !== requestedTarget`, return early (drop). Log at debug
    level only.
  - For a batch: filter the array; if empty after filtering, return early.
- The event ID generation and store recording happen **after** the filter check, so dropped signals
  are not recorded in the event store.

**`SSEChannel` interface** — add readonly property:
```ts
readonly requestedTarget: SignalTarget | undefined
```

### `server/fetch/response.ts` — `toSSEResponse`

- Extract `requestedTarget` from `urlObj.searchParams` via `extractRequestedTarget`.
- Pass `requestedTarget` into `channelOptions`.
- Add `X-ReStale-Supported` to the response headers (comma-separated list of the channel's
  configured targets).

### `server/node/attach.ts` — `attachSSE`

- Same as `toSSEResponse`: extract `requestedTarget` from `searchParams`, pass into
  `channelOptions`, add `X-ReStale-Supported` header.

### `client/core/client-contracts.ts`

- `ClientOptions.target` already exists and is already the right type; no change.
- No new entry needed in the `closed` reason union — `'revoked'` already covers this case. If
  callers need to distinguish *why* they were revoked, that's carried on the event detail (see
  below), not the status union.

### `client/core/sse-client.ts` — `SSEInvalidatorClient`

- In the constructor, when building `eventSourceUrl`, if `opts.target` is set also append
  `__restale_target__=<value>` as a second query param via `appendQueryParam`.
- In `wireInvalidateListener`'s existing `revoke` handler:
  - Parse the payload, now optionally including `reason`, `requested`, `supported`.
  - Existing behavior (`this.revoked = true`, `teardown()`, status → `{ status: 'closed', reason:
    'revoked' }`) is unchanged.
  - Pass the full detail (including `reason`/`requested`/`supported` when present) through the
    existing `revoke` `CustomEvent`, rather than dispatching a new event type.
  - Log line varies by reason, e.g. for `unsupported-target`:
    `[WARN][SSEInvalidatorClient] Connection revoked: requested target "<x>" is not supported by
    server. Supported: [...]. Auto-reconnect suppressed. connectionId: <id>.`

### `SSEInvalidatorClientEventMap`

- Extend the existing `revoke` entry's detail type to include the optional fields:
  ```ts
  revoke: CustomEvent<{ reason?: string; requested?: string; supported?: string[] }>
  ```
- No new event map entry.

### `client/react/useReStale.ts` — `UseReStaleOptions`

- No new `onReject` callback. `onRevoke` (existing) now receives the richer detail shape; consumers
  who want to react specifically to `unsupported-target` check `detail.reason` inside their
  existing `onRevoke` handler.

### `client/tanstack-query/adapter.ts` & `client/swr/adapter.ts`

No changes needed. These adapters never see `revoke` frames directly — handled by the client core
and the React hook, same as today.

---

## What Does NOT Change

- `processTargetSignals()` — already correctly stamps untagged signals; no modification needed.
- `SSEChannelGroup` — it delivers signals to channels; each channel's own filter handles the rest.
  The group does not know about per-connection requested targets.
- The `revoke` event *type* and its retry-suppression mechanism — unchanged. Unsupported-target
  rejection is a new *reason*, not a new *event*.
- Pubsub adapters — signal routing is unchanged.
- The `X-ReStale-Target` response header — already set by both transport adapters; semantics
  unchanged.
- Transport: still native `EventSource`. No move to `fetch()`-based streaming as part of this
  change.

---

## Logging Contract

| Location | Level | Message |
|---|---|---|
| `createSSEChannel` — unsupported-target revoke | `WARN` | `[WARN][createSSEChannel] Rejected connection: requested target "<x>" not in supported set [<...>]. connectionId: <id>.` |
| `createSSEChannel` — drop in invalidate | `DEBUG` (only if debug mode) | `[DEBUG][createSSEChannel] Dropped signal: target "<x>" does not match requested target "<y>". connectionId: <id>.` |
| `SSEInvalidatorClient` — revoke received (unsupported-target) | `WARN` | `[WARN][SSEInvalidatorClient] Connection revoked: requested "<x>", supported [<...>]. Auto-reconnect suppressed. connectionId: <id>.` |

---

## New SSE Event Frame

No new event frame type. Existing `revoke` frame gains optional structured fields:

```text
event: revoke
data: {"reason":"unsupported-target","requested":"rtk-query","supported":["tanstack-query","swr"]}

```

---

## Test Coverage Required

- `framing.ts`: revoke-frame formatter, extended with `reason`/`requested`/`supported` fields —
  unit test.
- `transport-utils.ts`: `extractRequestedTarget` — valid target, unknown value returns `undefined`,
  absent returns `undefined`.
- `channel.ts`:
  - Requested target not in supported set → `revoke` frame emitted with `reason:
    'unsupported-target'`, stream closes.
  - Requested target in supported set → stream opens normally, only matching frames emitted.
  - Signal with wrong explicit target → dropped, not recorded in event store, no frame emitted.
  - Signal with no target field → stamped with requested target, emitted normally.
  - Batched signals → partial filter (some dropped, some emitted).
- `sse-client.ts`:
  - `target` in options → `__restale_target__` appended to URL.
  - `revoke` event with `reason: 'unsupported-target'` received → status `{ status: 'closed',
    reason: 'revoked' }`, no retry, `revoke` `CustomEvent` dispatched with `reason`/`requested`/
    `supported` in detail.
  - Confirm `onopen` still fires before the `revoke` arrives (documented race, not a bug) — assert
    ordering in the test rather than asserting it doesn't happen.
- `toSSEResponse` / `attachSSE`:
  - `X-ReStale-Supported` header present on response.
  - `requestedTarget` extracted and passed to channel options.

---

## Non-Goals

- Multi-target requests from a single client (`?__restale_target__=swr,tanstack-query`). One
  connection, one target. Open two connections if you need both.
- The client reading or validating `X-ReStale-Supported` at runtime. Headers are devtools-only
  (native `EventSource` cannot read them from JS regardless).
- Changing `SSEChannelGroup` to be target-aware.
- Eliminating the `open` → `revoke` flicker for rejected connections. Not achievable with native
  `EventSource` as the transport; treated as documented behavior, not a defect.
- Migrating the transport off native `EventSource` to `fetch()`-based streaming to gain status-code
  visibility. Out of scope for this change.