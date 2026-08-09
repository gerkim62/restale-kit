# Fix: `useReStale` Ignores Changes to Non-`url` Client Options

**Package:** restale-kit
**Area:** `client/react/useReStale.ts`, `client/core/sse-client.ts`
**Status:** Proposed

## 1. Overview

`useReStale(url, opts)` only recreates its underlying `SSEInvalidatorClient` when the `url` string changes:

```ts
// useReStale.ts
if (urlRef.current !== url) {
  pendingClientRef.current = new SSEInvalidatorClient<TSignal>(url, {
    autoReconnect: opts.autoReconnect,
    reconnect: opts.reconnect,
    withCredentials: opts.withCredentials,
    debug: opts.debug,
    target: opts.target ?? opts.onInvalidate.__restaleTarget,
  })
  urlRef.current = url
}
```

Everything in that options object is captured **once**, at construction time. If a caller changes `target`, `withCredentials`, `debug`, or `reconnect`/`autoReconnect` on a re-render without also changing `url`, the change is silently dropped — the existing connection keeps running with the stale values, with no error and no warning.

This is intentional and correct for the four callback props (`onInvalidate`, `onRevoke`, `onRejected`, `onRetriesExhausted`), which are handled via refs and read live on every invocation. It is **not** correct for the rest of the options, which split into two categories that need different fixes.

## 2. Root Cause

`SSEInvalidatorClient`'s constructor stores every non-callback option as a `private readonly` field:

```ts
// sse-client.ts
private readonly reconnectOptions: ClientOptions<TSignal>['reconnect']
private readonly withCredentials: boolean
private readonly debug: boolean
```

`target` and `withCredentials` are additionally baked directly into the connection itself:

- `target` is serialized into `eventSourceUrl` as the `RESTALE_TARGET_PARAM` query param (sse-client.ts ~L113–120) — it is part of the URL the browser actually requests.
- `withCredentials` is passed straight into the native `new EventSource(url, { withCredentials })` call (sse-client.ts ~L347, ~L664) — a browser-level property that cannot be altered on an already-open `EventSource`.

`debug`, `reconnectOptions`, `maxRetries`, and the `autoReconnect` flags have no such constraint — they are pure internal state consulted only by the client's own retry loop and logger. They were captured as `readonly` alongside `target`/`withCredentials` as a blanket implementation choice ("everything passed to the constructor is fixed for the connection's lifetime"), not because anything forces it.

## 3. Proposed Fix

### 3.1 `target` / `withCredentials` — widen the identity check (requires reconnect)

These two values are structurally part of the connection identity, same as `url` — there is no way to change them without a new `EventSource`. The fix is to fold them into the existing swap mechanism rather than add a new one:

```ts
const identityKey = `${url}\u0000${String(opts.target ?? '')}\u0000${String(opts.withCredentials ?? false)}`

if (identityRef.current !== identityKey) {
  pendingClientRef.current = new SSEInvalidatorClient<TSignal>(url, { ...opts })
  identityRef.current = identityKey
}
```

The `useEffect` that commits the pending client and closes the previous one (currently keyed on `[url]`) should be re-keyed on the same composite value so the commit still only fires when identity actually changes.

No new staging/commit logic is needed — this reuses the render-phase-stages / effect-commits pattern already in place (`pendingClientRef` → `clientRef`), which exists specifically to stay safe under Concurrent Mode / StrictMode re-renders. Since all three values are primitives, `!==`/string-concat comparison remains stable across renders that don't actually change anything (no false-positive reconnects from object/function identity churn).

**Cost:** identical to a `url` change today — full reconnect (new handshake, new `connectionId`, backoff state reset). That cost is unavoidable for these two values regardless of implementation, so this is a correctness fix, not a performance trade-off.

### 3.2 `debug` / `reconnect` / `autoReconnect` — make live, no reconnect needed

These never touch the wire, so they don't need a diff-and-reconnect — they need the same live-write treatment already given to the callback props, applied directly to mutable fields on the client instead of via ref-wrapped closures:

```ts
// sse-client.ts — drop `readonly`
debug: boolean
reconnectOptions: ClientOptions<TSignal>['reconnect']
maxRetries: number
nativeAutoReconnect: boolean
jsBackoffAutoReconnect: boolean
```

```ts
// useReStale.ts — unconditionally, every render, once `client` exists
if (client) {
  client.debug = opts.debug ?? false
  client.reconnectOptions = opts.reconnect
  client.maxRetries = opts.reconnect?.maxRetries ?? PROTOCOL_CONSTANTS.DEFAULT_MAX_RETRIES
  // ...same normalization currently done once in the constructor for autoReconnect
}
```

No equality check is required — these fields are only read at the moment a decision is made (next log line, next backoff calculation), so overwriting them every render is safe. A reconnect already in flight simply finishes using whatever value was current when it started; there is no torn-state risk.

**Cost:** none. No reconnect, no new connection identity, no `connectionId` churn.

## 4. Why This Wasn't Caught Earlier

All five non-callback options are threaded through a single `opts` object into one constructor call, gated by the one check that `url` structurally requires (`EventSource` has no in-place update mechanism). That naturally produces "one rule: url changes ⇒ new client; nothing else does," without a separate audit of which of the *other* options actually needed to be part of that rule. In practice these are usually passed as static config (env vars, constants) rather than render-derived state, so the gap rarely surfaces — until a caller deliberately makes `target`, `withCredentials`, `debug`, or backoff tuning reactive (e.g. driven by other component state).

## 5. Risk Assessment

| Change | Reconnect required | Breaking? | Notes |
|---|---|---|---|
| §3.1 `target`/`withCredentials` reactive | Yes (unavoidable) | No — currently-silent no-op becomes correct behavior | Reuses existing staged-swap path; extend the `useEffect` dependency to the composite key |
| §3.2 `debug`/`reconnect`/`autoReconnect` reactive | No | No | Drop `readonly`, write from the hook every render; no new equality logic |

Neither change alters the public `useReStale`/`ClientOptions` API surface — only internal reactivity behavior. Existing callers who never change these options between renders (the common case) see no behavior difference.

## 6. Suggested Order

1. Ship §3.2 first — pure upside, no reconnect-cost trade-off, small diff (drop `readonly`, add live writes).
2. Ship §3.1 next — fixes a real correctness bug (silent no-op), but changes observable behavior (a reconnect now happens where none did before) for anyone currently relying on the no-op, so call it out in the changelog.
