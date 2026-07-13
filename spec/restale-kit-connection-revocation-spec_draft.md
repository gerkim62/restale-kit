# Connection Revocation — Design Spec

**Package:** restale-kit
**Status:** Core design decided. One item remains open (§5).

## 1. Problem

An open SSE connection has no way to learn its session ended (logout, ban, revoke) unless the server actively closes it. In a multi-instance deployment, the instance that needs to close it may not be the instance holding it. Neither capability exists today.

## 2. The meta-shape bug: `userId` alone isn't enough

Registering channels with only `{ userId }` (as the current examples do) makes per-login revocation impossible — browser A and browser B, same user, are indistinguishable. Revoking by `userId` closes both. That's correct for "sign out everywhere" / a ban, wrong for a normal logout.

**Required fix:** meta must carry an identifier unique per connection/login — `connectionId` — alongside `userId`.

| Intent | Call | Effect |
|---|---|---|
| Log out this browser only | `revoke({ userId, sessionId, connectionId })` | Closes exactly one connection within the authenticated scope |
| Sign out everywhere / ban | `revoke({ userId })` | Closes every session for that user |

This falls directly out of the subset-match semantics already used for cache keys (`matchesJSONValue`) — no new matching logic needed, just meta granular enough to use it correctly.

### 2.1 Populating `connectionId`

The client package generates an id once per connection and appends it to the SSE connection URL as a query param — the only option, since native `EventSource` can't send custom headers. Always generate this with a cryptographically strong, collision-resistant generator — `crypto.randomUUID()` — never a predictable or enumerable value (incrementing counter, timestamp, short random string). This ID is an opaque connection-correlation value, not authentication: an HTTP client can submit an arbitrary value. Production request handlers must combine it with trusted metadata such as an authenticated `userId` and server-authenticated `sessionId`; UUID unguessability is not authorization. This is fully automatic; the app developer never touches it.

On the server, `attachSSE(req, res, options)` and `toSSEResponse(request, options)` read the internal `restaleKitRequestId` query param off the incoming request and expose it as `connectionId` — the app developer does not extract it manually:

```ts
app.get('/sse', (req, res) => {
  const userId = UserIdSchema.parse(req.query.userId)     // manual — app-defined identity
  const { channel, connectionId } = attachSSE(req, res, { signalSchema: AppSignalSchema })
  group.register(channel, { userId, connectionId }) // spread the extracted id in
})
```

`userId` (and any other app-defined identity — session id, roles, tenant id, etc.) stays manual: the package has no way to know an app's auth model, so it can't and shouldn't guess how to extract or shape that data. `connectionId` is different in kind — it's not app auth state, it's *connection* identity that `revoke()`'s own correctness depends on. Leaving it manual would mean a developer who forgets to wire it silently reintroduces the exact bug this feature exists to fix — with no error, just a scoped `revoke({ userId, sessionId, connectionId })` that matches nothing. The package owns the one field its own core feature requires; it still owns none of the fields the app defines. The internal `restaleKitRequestId` query parameter is transport-level protocol identity, not the app's session concept.

The query param name is deliberately namespaced (`restaleKitRequestId`, not `sessionId` or `sid`) and fixed, not configurable — this avoids colliding with an app's own query params or session cookie/id naming, and guarantees client-side generation and server-side extraction agree without a matching config option on both ends.

`attachSSE` returns `{ channel, connectionId }` instead of a bare `SSEChannel`; `toSSEResponse` returns `{ response, channel, connectionId }`. If the query param is missing or malformed, both throw synchronously before the channel is created (same failure timing as an invalid `signalSchema`), rather than falling back to `undefined` — a channel silently registered without a `connectionId` cannot be revoked with per-connection precision, which defeats the fix in §2.

There's no `groupId`. `controlTopic` stays a plain optional string, same pattern as ordinary topics.

## 3. `broadcast()` vs `revoke()` — different defaults, both correct

`broadcast(signal, predicate)` needs no change. It's *supposed* to be broad: if user 42 edits something from their phone, every open tab of theirs should refresh — not just the one that made the edit.

`revoke()` defaults the opposite way: scope to one session unless the caller deliberately widens to `userId`. Same matching mechanism, opposite default blast radius.

## 4. API

- **`revoke(criteria: JSONValue): Promise<{ localClosed: number }>`** — the only public entry point. Subset-matches `criteria` against meta (§2 table), closes local matches immediately via an internal deregister step, then publishes to every other instance. There's no separate public "local-only" method — one name to learn.

**`PubSubAdapter`:** `publish`/`subscribe` carry a discriminated union payload, so a single pair of methods handles both invalidation signals and control messages with full type safety via the discriminant:

```ts
type PubSubMessage<TSignal extends InvalidateSignal> =
  | { kind: 'signal'; data: TSignal | TSignal[] }
  | { kind: 'control'; data: JSONValue }

interface PubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal> {
  publish(topic: string, message: PubSubMessage<TSignal>): Promise<void>
  subscribe(topic: string, onMessage: (message: PubSubMessage<TSignal>) => void): Promise<() => void | Promise<void>>
  onError?(handler: (error: unknown) => void): void
}
```

Scope of the break: this hits adapter *implementors* only (redis/ably/pusher, or any custom `PubSubAdapter`). `SSEChannelGroup`'s own public methods (`register`, `broadcast`, `publish`, `revoke`) are unchanged — it wraps/unwraps `PubSubMessage` internally at this one boundary.

Per-adapter work needed:
- Redis / Ably: replace the `isSignalPayload`-only check with a `kind` branch. `control` payloads validate against the already-existing `isJSONValue` guard — no new validator to write.
- Pusher: `handleWebhook` currently only dispatches events named `'invalidate'`. `publish` now triggers `'invalidate'` or `'control'` depending on `message.kind`; `handleWebhook` gains the matching branch. Same channel, two event names.

**Control-topic subscription lifecycle:** `SSEChannelGroup` opens the control subscription via `pubsub.subscribe(controlTopic, ...)` directly, outside `TopicManager`'s per-topic refcounting — `TopicManager` only opens a topic once some channel registers on it, and tears it down at zero, which is the opposite of "permanent, can arrive with zero connections open." This is what actually makes it durable, not the widened type on its own.

**`dispose()`:** unsubscribes the control-topic subscription only. Idempotent. Does not close registered channels.
- Codebase precedent — blanket effects are always separately, explicitly named (`broadcast` vs `broadcastToAll`), never a hidden side effect of a narrower call.
- Ownership — the control subscription is the one resource the group itself creates; registered channels are created by the transport layer and merely indexed by the group.
- Composability — a real process shutdown already drains connections via the HTTP server; a `dispose()` that also force-closed channels would race with or duplicate that.

**Control-topic naming:** `controlTopic?: string`, optional, defaulting to a fixed collision-resistant string (e.g. `__restale_control__`) — same pattern as any other topic string passed to `register()`.

## 5. Remaining open items

1. Partial-failure handling — local revoke succeeds but broker publish fails: propagate the error (consistent with `publish()` today), or something else?
2. `attachSSE`/`toSSEResponse` return-shape widening (§2.1) is a breaking change for existing callers destructuring a bare `SSEChannel` from `attachSSE`. Ship as a major version bump, or accept the break inside this feature's own minor/patch (package is presumably pre-1.0)?

## 6. Non-goals

- Not a ban mechanism — doesn't block reconnection; that's the app's own auth check.
- Not guaranteed-delivery beyond what the broker provides.
- Not an authorization system for who may call `revoke()`.
