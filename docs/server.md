# Server Guide

The server side has two concerns:
1. **Accepting SSE connections** — using a framework adapter to create an `SSEChannel` per client.
2. **Broadcasting invalidations** — using `SSEChannelGroup` to send signals to the right clients.

---

## Framework adapters

All adapters create an `SSEChannel` and set the required SSE response headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`). They also wire up disconnect detection automatically — when the client disconnects, the adapter calls `channel.disconnect()` to close the transport stream.

The channel is also **automatically deregistered** from the group when it closes — you do not need a manual cleanup listener. The auto-deregister hook is wired by `group.register()` on first registration.

### Express

```ts
import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/express'

const app = express()
const group = new SSEChannelGroup()

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  group.register(channel, { userId: req.user?.id })
})
```

### Native Node.js `http`

```ts
import http from 'node:http'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/node'

const group = new SSEChannelGroup()

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  if (req.method === 'GET' && url.pathname === '/sse') {
    const channel = attachSSE(req, res)
    group.register(channel, { userId: req.user?.id })
  }
})
```

### Fastify

`restale-kit/fastify` accepts either Fastify's wrapped `request`/`reply` objects or the raw `request.raw`/`reply.raw` Node objects. When you pass the wrapped objects, `attachSSE` automatically calls `reply.hijack()` for you — you don't need to do it manually.

`reply.hijack()` tells Fastify to give up ownership of the underlying socket. Without it, Fastify's lifecycle hooks try to write their own response on top of the SSE stream after your handler returns, corrupting the output.

```ts
import Fastify from 'fastify'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/fastify'
import { z } from 'zod'

const group = new SSEChannelGroup()
const app = Fastify()

// Preferred: pass request/reply directly — reply.hijack() is called automatically
app.get('/sse', (request, reply) => {
  const channel = attachSSE(request, reply)
  group.register(channel, { userId: request.user?.id })
})
```

If you need to use the raw Node objects (e.g. in a middleware context), you must call `reply.hijack()` yourself before passing them:

```ts
app.get('/sse', (request, reply) => {
  reply.hijack() // required when passing .raw objects directly
  const channel = attachSSE(request.raw, reply.raw)
  group.register(channel, { userId: request.user?.id })
})
```

### Hono (Cloudflare Workers, Bun, Deno, edge)

Fetch-API runtimes use an inverted response model — `toSSEResponse` returns the `Response` to hand back to the framework and the `SSEChannel` to call `invalidate()` on. The connection ID is accessible as `channel.connectionId`.

```ts
import { Hono } from 'hono'
import { SSEChannelGroup } from 'restale-kit/server'
import { toSSEResponse } from 'restale-kit/hono'

const app = new Hono()
const group = new SSEChannelGroup()

app.get('/sse', (c) => {
  const { response, channel } = toSSEResponse(c.req.raw)
  group.register(channel, { userId: c.req.header('X-User-ID') })
  return response // hand it back to Hono
})
```

### Generic Fetch API (`restale-kit/fetch`)

For any other Fetch-API runtime (Bun, Deno, plain `Request`/`Response`):

```ts
import { toSSEResponse } from 'restale-kit/fetch'

// Same API as restale-kit/hono
const { response, channel } = toSSEResponse(request)
```

---

## `SSEChannelGroup`

`SSEChannelGroup` manages all connected clients and is where you send invalidation signals and control revocations.

```ts
import { SSEChannelGroup } from 'restale-kit/server'

const group = new SSEChannelGroup()

// With typed metadata
interface ClientMeta {
  userId: string
  roles: string[]
}
const typedGroup = new SSEChannelGroup<InvalidateSignal, ClientMeta>()
```

**Constructor options:**

| Option | Type | Description |
|---|---|---|
| `metaSchema` | `StandardSchemaV1` | Validates metadata on `register()`. Throws `SchemaValidationError` on failure. |
| `pubsub` | `PubSubAdapter` | Distributed pub/sub adapter for multi-instance deployments. See [Pub/Sub guide](./pubsub.md). |
| `eventBufferCapacity` | `number` | Enables Last-Event-ID history replay buffer up to `N` events. |
| `eventStore` | `EventStore` | Custom event store for persistent or externally managed replay storage. |
| `controlTopic` | `string` | Custom control topic name for cross-cluster revocations (default: `'__restale_control__'`). |

---

## `register` and `deregister`

```ts
// If TMeta accepts undefined, metadata is optional:
group.register(channel)

// If TMeta does not accept undefined, metadata is required:
group.register(channel, meta)

// With topics routing:
group.register(channel, meta, { topics: ['user:42', 'global'] })

group.deregister(channel)
```

- `meta` is optional only when `TMeta` accepts `undefined`. If it does not accept `undefined`, metadata must be provided.
- Omitting `meta` (or passing `undefined`) registers `undefined` as metadata, meaning the channel has no metadata properties. See [Broadcasting without metadata](#broadcasting-without-metadata) and [Revocation without metadata](#revocation-without-metadata) for the implications.
- `topics` is an optional list of pub/sub topic strings this connection subscribes to. Only relevant when using a pub/sub adapter.

**Automatic cleanup:** When a channel closes (peer disconnect, server `close()`, or stream cancellation), it is automatically deregistered from the group. You do not need a manual `req.on('close', ...)` listener for cleanup. `group.deregister(channel)` is still available if you need to remove a channel before it closes.

---

## Broadcasting

### `broadcastToAll(signal)` — all clients

```ts
// Invalidate the 'todos' key for every connected client
group.broadcastToAll({ key: ['todos'] })

// Invalidate everything (useful after a deployment)
group.broadcastToAll({ key: [] })

// Batch: multiple signals in one SSE frame
group.broadcastToAll([
  { key: ['todos'] },
  { key: ['todos-count'] },
])
```

`broadcastToAll` reaches **all** registered channels, including those registered without metadata.

### `broadcast(signal, predicate)` — filtered broadcast (preferred)

Use a predicate against each channel's registered metadata to scope the invalidation:

```ts
// Only invalidate for a specific user
group.broadcast(
  { key: ['todos', { userId: '42' }] },
  (meta) => meta.userId === '42'
)

// Invalidate admin data only for admin users
group.broadcast(
  { key: ['admin-data'] },
  (meta) => meta.roles.includes('admin')
)
```

The predicate receives `TMeta` directly — when `TMeta` includes `undefined` (i.e. metadata was omitted on registration), the predicate receives `undefined` and must handle it explicitly.

### `broadcastByKey(signal)` — automatic key-based matching

Broadcasts to channels whose registered metadata matches the signal's key using hierarchical prefix/exact matching semantics.

```ts
group.broadcastByKey({ key: ['todos', { userId }] })
```

The signal's `key` is matched against each channel's registered metadata (which can be a JSON array key or an object/scalar value automatically matched against the signal key). A channel receives the signal when its registered metadata matches or extends the signal key (when `exact: true`, keys must match exactly).

### Broadcasting without metadata

Channels registered without metadata (`group.register(channel)`, no `meta` argument) have `undefined` metadata. They are included in `broadcastToAll` and in `broadcast` calls — the predicate receives `undefined` for those channels. They are **excluded** from `broadcastByKey` because `undefined` is not a valid JSON value and cannot participate in key-based matching.

---

## Connection Revocation

To actively close client connections (e.g., on logout, session expiration, or user ban), the group provides two dedicated APIs.

### Criteria-Based Revocation (`revokeWhere()`)

Closes all channels whose metadata matches `criteria` via subset matching. If a pub/sub adapter is configured, also broadcasts to the control topic so remote instances close matching connections.

Before closing each channel, `revokeWhere` sends a terminal `revoke` SSE event frame to the client. The client receives this frame, sets its status to `{ status: 'closed', reason: 'revoked' }`, suppresses automatic reconnection, and calls `onRevoke` if provided. This distinguishes an intentional server kick from a transient network error.

```ts
// Close all connections for user-42 across the entire cluster
await group.revokeWhere({ userId: 'user-42' })
```

Returns `{ localClosed: number }`.

### Connection-Specific Revocation (`revokeByConnectionId()`)

Closes the single channel identified by `connectionId`. Pass `scope` (a partial metadata object) to verify ownership before closing — if the channel's metadata does not match `scope`, nothing happens and `{ closed: false }` is returned.

Like `revokeWhere`, this sends a terminal `revoke` SSE event frame to the client before closing the channel. The client will not auto-reconnect after receiving it.

When a pub/sub adapter is configured, `revokeByConnectionId` automatically broadcasts a control message to the cluster so that the connection is revoked on whichever server instance it is currently connected to.

```ts
// Close one specific connection, scoped to the requesting user
const result = await group.revokeByConnectionId(connectionId, { userId: req.user.id })
// result: { closed: boolean }
```

### Revocation without metadata

Channels registered without metadata (`group.register(channel)`, no `meta` argument) **cannot be targeted by `revokeWhere()`**. Omitting metadata registers `undefined` as metadata. Because `undefined` is not a valid JSON value, criteria matching is skipped entirely for those channels — even `revokeWhere({})` returns `localClosed: 0` for them.

To revoke a channel that has no metadata, use `revokeByConnectionId(connectionId)` instead:

```ts
// ❌ Does not work — revokeWhere cannot match channels with undefined meta
await group.revokeWhere({})

// ✅ Works — revokeByConnectionId looks up by connectionId, bypassing metadata matching
await group.revokeByConnectionId(channel.connectionId)
```

If you need criteria-based revocation, always register channels with explicit metadata.

### Security: always scope client-supplied connection IDs

`connectionId` is generated as a UUID by the client package and is useful for correlating a logout request with one SSE connection. It is **not** an authentication credential: a client can submit any value to an HTTP endpoint. Do not use a bare `revokeByConnectionId(connectionId)` call in a request handler.

Register trusted identity metadata from your authentication layer (at least `userId`; use a server-authenticated `sessionId` when available), then include that metadata in the `scope` of `revokeByConnectionId(...)` or in the criteria of `revokeWhere(...)`. This ensures that an arbitrary or leaked connection ID cannot revoke a connection outside the authenticated user's/session's scope. UUID unguessability reduces accidental discovery, but is not authorization. Always pass `scope` with trusted server-side identity (e.g. `{ userId: req.user.id }`) so that a forged or leaked `connectionId` cannot close another user's connection.

If the client does not send a connection ID, revoke the trusted session instead using criteria-based revocation; this may close more than one tab:

```ts
await group.revokeWhere({
  userId: req.user.id,
  sessionId: req.session.id,
})
```

When a pub/sub adapter is configured, `revokeWhere()` automatically broadcasts control messages across the cluster to reach matching connections on other server instances.

---

## Reconnection & Event History Replay

To prevent missed invalidation signals during momentary network drops, create a shared `eventStore` and pass it to both `SSEChannelGroup` and your transport helper (`attachSSE` / `toSSEResponse`):

```ts
import { createEventStore, SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/express'

// Shared event store (retains history for Last-Event-ID replay)
const eventStore = createEventStore({ capacity: 100 })
const group = new SSEChannelGroup({ eventStore })

app.get('/sse', (req, res) => {
  // Pass eventStore to transport helper so reconnecting channels replay missed history
  const channel = attachSSE(req, res, { eventStore })
  group.register(channel, { userId: req.user.id })
})
```

When a client reconnects sending the standard `Last-Event-ID` HTTP header (enforced up to a maximum length of 512 bytes for security protection), `attachSSE`/`toSSEResponse` extracts the header and passes `eventStore` to the channel, which automatically replays missed invalidation events in sequence before resuming the live stream.


---

## Teardown (`dispose()`)

Call `group.dispose()` during graceful server shutdown to unsubscribe control topic listeners without force-closing client channels:

```ts
process.on('SIGTERM', async () => {
  await group.dispose()
  server.close()
})
```
