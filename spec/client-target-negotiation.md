# Client Target Negotiation

**Status:** Draft  
**Date:** 2026-07-18

---

## Goal

Let the client declare which signal target it wants at connection time via a query parameter.
The server reads it, filters frames to that target only (saving bandwidth), and echoes negotiation
metadata in response headers. If the requested target is not supported by the server channel, the
server terminates the connection with a typed SSE event so the client never retries blindly.

This is an improvement to existing behavior, not an additive opt-in feature. The `target` field
already exists on both sides; this wires them together over the wire.

---

## Current State

| Layer | What happens today |
|---|---|
| Server | `target` set in `SSEChannelOptions` by the developer. `processTargetSignals()` stamps untagged signals. `X-ReStale-Target` echoed in the SSE response headers (set by transport adapters). |
| Client | `ClientOptions.target` exists but is **never sent to the server**. Used only locally in adapter callbacks to skip non-matching signals. |
| Wire | No query param, no negotiation, no filtering. Every frame goes to every client regardless of its target. |

---

## Proposed Wire Contract

### 1. Client sends target in the request query string

```
GET /sse?__restale_cid__=abc123&__restale_target__=swr
```

- Parameter name: `__restale_target__`
- Single value only (not an array). One connection = one target.
- Optional. If absent, behavior is unchanged (server sends all targets, no filtering).
- The client sends whatever is in `ClientOptions.target`. Framework adapters (`useSwrAdapter`,
  `useTanstackQueryAdapter`) already default `target` — they will now also append the param
  automatically.

### 2. Server responds with two headers

On a successful SSE response:

```
X-ReStale-Target: swr
X-ReStale-Supported: tanstack-query, swr
```

| Header | Value | Meaning |
|---|---|---|
| `X-ReStale-Target` | The *single* target being returned | Already exists; semantics unchanged |
| `X-ReStale-Supported` | Comma-separated list of all targets the channel supports | New |

Both headers are informational for developers / devtools. The client does not parse them at
runtime (see §3 below for why).

### 3. Unsupported target: `reject` SSE event (not 4xx)

When the client requests `?__restale_target__=rtk-query` but the server channel is configured
with `target: ['tanstack-query', 'swr']`, the server:

1. Accepts the connection (200 OK, SSE headers written)
2. Immediately emits a `reject` event frame:
   ```
   event: reject
   data: {"reason":"unsupported-target","requested":"rtk-query","supported":["tanstack-query","swr"]}
   ```
3. Closes the stream

**Why a `reject` event instead of 4xx:**  
Native `EventSource` does not expose HTTP status codes. A 4xx fires `onerror` with
`readyState === CLOSED`, which is indistinguishable from a network error — causing the client to
retry until `maxRetries` is exhausted. A `reject` event gives the client typed, actionable
information and lets it suppress retries immediately, the same way `revoke` already works.

**Difference from `revoke`:**  
`revoke` = "you were connected and I'm kicking you out" (session expiry, logout, ban).  
`reject` = "you asked for something I don't support; don't bother reconnecting with the same params".

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
- Add `SSE_EVENTS.REJECT = 'reject'`.

### `types/protocol.ts`

No type changes needed. The `reject` payload is a plain JSON object, not an `InvalidateSignal`.

### `server/core/framing.ts`

- Add `formatRejectFrame(reason: string, requested: string, supported: string[])` → `Uint8Array`.
  Produces:
  ```
  event: reject
  data: {"reason":"unsupported-target","requested":"<val>","supported":["..."]}
  ```

### `server/transport-utils.ts`

- Add `extractRequestedTarget(searchParams: URLSearchParams): string | undefined`.
  Reads `__restale_target__`, validates it is a known `SignalTarget` value, returns `undefined`
  if absent. Does **not** throw — absence means "no preference, send everything".

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
- If it is **not** in the supported set: emit `formatRejectFrame(...)`, then call `closeInternal()`.
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

### `server/transport-utils.ts`

Update `extractLastEventId` style: add parallel `extractRequestedTarget` function as described
above.

### `server/fetch/response.ts` — `toSSEResponse`

- Extract `requestedTarget` from `urlObj.searchParams` via `extractRequestedTarget`.
- Pass `requestedTarget` into `channelOptions`.
- Add `X-ReStale-Supported` to the response headers (comma-separated list of the channel's
  configured targets).

### `server/node/attach.ts` — `attachSSE`

- Same as `toSSEResponse`: extract `requestedTarget` from `searchParams`, pass into
  `channelOptions`, add `X-ReStale-Supported` header.

### `client/core/client-contracts.ts`

No structural changes needed. `ClientOptions.target` already exists and is already the right type.

### `client/core/sse-client.ts` — `SSEInvalidatorClient`

- In the constructor, when building `eventSourceUrl`, if `opts.target` is set also append
  `__restale_target__=<value>` as a second query param via `appendQueryParam`.
- Add `reject` event listener in `wireInvalidateListener`:
  - Parse the payload: `{ reason, requested, supported }`.
  - Set `this.revoked = true` (reuses the "suppress retry" flag — exact same semantics).
  - Call `this.teardown()`.
  - Set status: `{ status: 'closed', reason: 'rejected' }` — new reason value.
  - Dispatch `CustomEvent('reject', { detail: { reason, requested, supported } })`.
  - Log: `[WARN][SSEInvalidatorClient] Connection rejected: requested target "<x>" is not
    supported by server. Supported: [...]. Auto-reconnect suppressed. connectionId: <id>.`

### `client/core/client-contracts.ts` — `ConnectionStatus`

Add `'rejected'` to the `closed` reason union:
```ts
| { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' | 'rejected' }
```

### `SSEInvalidatorClientEventMap`

Add:
```ts
reject: CustomEvent<{ reason: string; requested: string; supported: string[] }>
```

### `client/react/useReStale.ts` — `UseReStaleOptions`

Add optional callback (parallel to `onRevoke`):
```ts
onReject?: (details: { reason: string; requested: string; supported: string[] }) => void
```

Wire it up in a `useEffect` alongside the `revoke` listener. Ref-stabilized like `onRevoke`.

### `client/tanstack-query/adapter.ts` & `client/swr/adapter.ts`

No changes needed. These adapters never see the `reject` event — it is handled by the client
core and the React hook.

---

## What Does NOT Change

- `processTargetSignals()` — already correctly stamps untagged signals; no modification needed.
- `SSEChannelGroup` — it delivers signals to channels; each channel's own filter handles the rest.
  The group does not know about per-connection requested targets.
- The `revoke` flow — `reject` is a parallel path using the same "suppress retry" mechanism.
- Pubsub adapters — signal routing is unchanged.
- The `X-ReStale-Target` response header — already set by both transport adapters; semantics
  unchanged.

---

## Logging Contract

| Location | Level | Message |
|---|---|---|
| `createSSEChannel` — reject path | `WARN` | `[WARN][createSSEChannel] Rejected connection: requested target "<x>" not in supported set [<...>]. connectionId: <id>.` |
| `createSSEChannel` — drop in invalidate | `DEBUG` (only if debug mode) | `[DEBUG][createSSEChannel] Dropped signal: target "<x>" does not match requested target "<y>". connectionId: <id>.` |
| `SSEInvalidatorClient` — reject received | `WARN` | `[WARN][SSEInvalidatorClient] Connection rejected by server: requested "<x>", supported [<...>]. Auto-reconnect suppressed. connectionId: <id>.` |

---

## New SSE Event Frame

```
event: reject
data: {"reason":"unsupported-target","requested":"rtk-query","supported":["tanstack-query","swr"]}

```

---

## Test Coverage Required

- `framing.ts`: `formatRejectFrame` unit test.
- `transport-utils.ts`: `extractRequestedTarget` — valid target, unknown value returns `undefined`,
  absent returns `undefined`.
- `channel.ts`:
  - Requested target not in supported set → `reject` frame emitted, stream closes.
  - Requested target in supported set → stream opens normally, only matching frames emitted.
  - Signal with wrong explicit target → dropped, not recorded in event store, no frame emitted.
  - Signal with no target field → stamped with requested target, emitted normally.
  - Batched signals → partial filter (some dropped, some emitted).
- `sse-client.ts`:
  - `target` in options → `__restale_target__` appended to URL.
  - `reject` event received → status `{ status: 'closed', reason: 'rejected' }`, no retry,
    `reject` CustomEvent dispatched with correct detail.
- `toSSEResponse` / `attachSSE`:
  - `X-ReStale-Supported` header present on response.
  - `requestedTarget` extracted and passed to channel options.

---

## Non-Goals

- Multi-target requests from a single client (`?__restale_target__=swr,tanstack-query`). One
  connection, one target. Open two connections if you need both.
- The client reading or validating `X-ReStale-Supported` at runtime. Headers are devtools-only.
- Changing `SSEChannelGroup` to be target-aware.
