# Connection Revocation — Design Spec

**Package:** restale-kit
**Status:** Core design decided. All open items resolved (§5).

## 1. Problem

An open SSE connection has no way to learn its session ended (logout, ban, revoke) unless the server actively closes it. In a multi-instance deployment, the instance that needs to close it may not be the instance holding it. Neither capability exists today.

## 2. The meta-shape bug: `userId` alone isn't enough

Registering channels with only `{ userId }` (as the current examples do) makes per-login revocation impossible — browser A and browser B, same user, are indistinguishable. Revoking by `userId` closes both. That's correct for "sign out everywhere" / a ban, wrong for a normal logout.

**Required fix:** meta must carry an identifier unique per connection/login — `connectionId` — alongside `userId`.

| Intent | Call | Effect |
|---|---|---|
| Log out this browser only | `revokeByConnectionId(channel.connectionId, { userId, sessionId })` | Closes exactly one connection within the authenticated scope |
| Sign out everywhere / ban | `revokeWhere({ userId })` | Closes every session for that user |

This falls directly out of the subset-match semantics already used for cache keys (`matchesJSONValue`) — no new matching logic needed, just meta granular enough to use it correctly.

### 2.1 Populating `connectionId`

The client package generates an id once per connection and appends it to the SSE connection URL as a query param — the only option, since native `EventSource` can't send custom headers. By default, `crypto.randomUUID()` is used as the secure generator. If custom generators are provided via public overrides (e.g. `idGenerator`), they must produce collision-resistant, non-predictable values, avoiding predictable or enumerable identifiers (such as counters, timestamps, or short random strings). This ID is an opaque connection-correlation value, not authorization: an HTTP client can submit an arbitrary value. Production request handlers must combine it with trusted metadata such as an authenticated `userId` and server-authenticated `sessionId`; unguessability is not authorization. This is fully automatic by default; the app developer never touches it unless supplying custom configuration options.

On the server, `attachSSE(req, res, options)` and `toSSEResponse(request, options)` read the internal `restaleKitRequestId` query param off the incoming request and expose it as `connectionId` — the app developer does not extract it manually:

```ts
app.get('/sse', (req, res) => {
  const userId = UserIdSchema.parse(req.query.userId)     // manual — app-defined identity
  const channel = attachSSE(req, res, { signalSchema: AppSignalSchema })
  // channel.connectionId is populated automatically from the restaleKitRequestId query param
  // The group reads it internally — no need to pass it into metadata
  group.register(channel, { userId })
})
```

`userId` (and any other app-defined identity — session id, roles, tenant id, etc.) stays manual: the package has no way to know an app's auth model, so it can't and shouldn't guess how to extract or shape that data. `connectionId` is different in kind — it's not app auth state, it's *connection* identity that `revokeWhere()`'s own correctness depends on. Leaving it manual would mean a developer who forgets to wire it silently reintroduces the exact bug this feature exists to fix — with no error, just a scoped `revokeByConnectionId(channel.connectionId, { userId, sessionId })` that matches nothing. The package owns the one field its own core feature requires; it still owns none of the fields the app defines. The internal `restaleKitRequestId` query parameter is transport-level protocol identity, not the app's session concept.

The query param name is deliberately namespaced (`restaleKitRequestId`, not `sessionId` or `sid`) and fixed, not configurable — this avoids colliding with an app's own query params or session cookie/id naming, and guarantees client-side generation and server-side extraction agree without a matching config option on both ends.

`attachSSE` returns a bare `SSEChannel`; the connection ID is available as `channel.connectionId` and is read by the group internally. `toSSEResponse` returns `{ response, channel }`. If the query param is missing or malformed, both throw synchronously before the channel is created (same failure timing as an invalid `signalSchema`), rather than falling back to `undefined` — a channel silently registered without a `connectionId` cannot be revoked with per-connection precision, which defeats the fix in §2.

There's no `groupId`. `controlTopic` stays a plain optional string, same pattern as ordinary topics.

## 3. `broadcast()` vs `revoke()` — different defaults, both correct

`broadcast(signal, predicate)` needs no change. It's *supposed* to be broad: if user 42 edits something from their phone, every open tab of theirs should refresh — not just the one that made the edit.

`revoke()` defaults the opposite way: scope to one session unless the caller deliberately widens to `userId`. Same matching mechanism, opposite default blast radius.

## 4. API

- **`revokeWhere(criteria: JSONValue): Promise<{ localClosed: number }>`** — closes all channels whose metadata subset-matches `criteria` (§2 table) locally, then broadcasts to the cluster. Channels registered without metadata are excluded from criteria matching — use `revokeByConnectionId` for those.
- **`revokeByConnectionId(connectionId: string, scope?: Record<string, JSONValue>): Promise<{ closed: boolean }>`** — closes the single channel identified by `connectionId`. Pass `scope` to verify ownership against the channel's registered metadata before closing. Broadcasts a control message to the cluster if a pub/sub adapter is configured.

**`PubSubAdapter`:** `publish`/`subscribe` carry a discriminated union payload, so a single pair of methods handles both invalidation signals and control messages with full type safety via the discriminant:

> See `pubsub-adapter-contract.md` for the full `PubSubAdapter` and `PubSubMessage` interface definitions. The `PubSubMessage` discriminated union (`kind: 'signal' | 'control'`) is what allows a single `publish`/`subscribe` pair to carry both invalidation signals and revocation control messages.

Scope of the break: this hits adapter *implementors* only (redis/ably/pusher, or any custom `PubSubAdapter`). `SSEChannelGroup`'s own public methods (`register`, `broadcast`, `publish`, `revokeWhere`, `revokeByConnectionId`) are unchanged — it wraps/unwraps `PubSubMessage` internally at this one boundary.

Per-adapter work needed:
- Redis / Ably: replace the `isSignalPayload`-only check with a `kind` branch. `control` payloads validate against the already-existing `isJSONValue` guard — no new validator to write.
- Pusher: `handleWebhook` currently only dispatches events named `'invalidate'`. `publish` now triggers `'invalidate'` or `'control'` depending on `message.kind`; `handleWebhook` gains the matching branch. Same channel, two event names.

**Control-topic subscription lifecycle:** `SSEChannelGroup` opens the control subscription via `pubsub.subscribe(controlTopic, ...)` directly, outside `TopicManager`'s per-topic refcounting — `TopicManager` only opens a topic once some channel registers on it, and tears it down at zero, which is the opposite of "permanent, can arrive with zero connections open." This is what actually makes it durable, not the widened type on its own.

**`dispose()`:** unsubscribes the control-topic subscription only. Idempotent. Does not close registered channels.
- Codebase precedent — blanket effects are always separately, explicitly named (`broadcast` vs `broadcastToAll`), never a hidden side effect of a narrower call.
- Ownership — the control subscription is the one resource the group itself creates; registered channels are created by the transport layer and merely indexed by the group.
- Composability — a real process shutdown already drains connections via the HTTP server; a `dispose()` that also force-closed channels would race with or duplicate that.

**Control-topic naming:** `controlTopic?: string`, optional, defaulting to `'__restale_control__'` — same pattern as any other topic string passed to `register()`.

## 5. Status of previous open items

1. Partial-failure handling — local revoke succeeds but broker publish fails: propagate the error (consistent with `publish()` today). Resolved.
2. `attachSSE`/`toSSEResponse` return-shape (§2.1): `attachSSE` returns a bare `SSEChannel` with `connectionId` on the channel object; `toSSEResponse` returns `{ response, channel }`. Resolved.

## 6. Non-goals

- Not a ban mechanism — doesn't block reconnection; that's the app's own auth check.
- Not guaranteed-delivery beyond what the broker provides.
- Not an authorization system for who may call `revoke()`.
