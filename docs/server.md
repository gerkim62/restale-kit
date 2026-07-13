# Server Guide

The server side has two concerns:
1. **Accepting SSE connections** — using a framework adapter to create an `SSEChannel` per client.
2. **Broadcasting invalidations** — using `SSEChannelGroup` to send signals to the right clients.

---

## Framework adapters

All adapters create an `SSEChannel` and set the required SSE response headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`). They also wire up disconnect detection automatically — when the client disconnects, the adapter calls `channel.disconnect()` to close the transport stream. **Route handlers are still responsible for calling `group.deregister(channel)`** to remove the channel from the group.

### Express

```ts
import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/express'

const app = express()
const group = new SSEChannelGroup()

app.get('/sse', (req, res) => {
  const { channel, restaleKitRequestId } = attachSSE(req, res)
  group.register(channel, { userId: req.user?.id, restaleKitRequestId })
  req.on('close', () => group.deregister(channel))
})
```

### Native Node.js `http`

```ts
import http from 'node:http'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/node'

const group = new SSEChannelGroup()

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/sse') && req.method === 'GET') {
    const { channel, restaleKitRequestId } = attachSSE(req, res)
    group.register(channel, { restaleKitRequestId })
    req.on('close', () => group.deregister(channel))
  }
})
```

### Fastify

Fastify manages the HTTP response internally, so you must call `reply.hijack()` before handing the socket to `attachSSE`. Without it, Fastify will write its own response on top of the SSE stream.

```ts
import Fastify from 'fastify'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/fastify'

const app = Fastify()
const group = new SSEChannelGroup()

app.get('/sse', (request, reply) => {
  reply.hijack() // required
  const { channel, restaleKitRequestId } = attachSSE(request.raw, reply.raw)
  group.register(channel, { restaleKitRequestId })
  request.raw.on('close', () => group.deregister(channel))
})
```

### Hono (Cloudflare Workers, Bun, Deno, edge)

Fetch-API runtimes use an inverted response model — `toSSEResponse` returns the `Response` to hand back to the framework, the `SSEChannel` to call `invalidate()` on, and the generated `restaleKitRequestId`.

```ts
import { Hono } from 'hono'
import { SSEChannelGroup } from 'restale-kit/server'
import { toSSEResponse } from 'restale-kit/hono'

const app = new Hono()
const group = new SSEChannelGroup()

app.get('/sse', (c) => {
  const { response, channel, restaleKitRequestId } = toSSEResponse(c.req.raw)
  group.register(channel, { restaleKitRequestId })
  c.req.raw.signal.addEventListener('abort', () => group.deregister(channel))
  return response // hand it back to Hono
})
```

### Generic Fetch API (`restale-kit/fetch`)

For any other Fetch-API runtime (Bun, Deno, plain `Request`/`Response`):

```ts
import { toSSEResponse } from 'restale-kit/fetch'

// Same API as restale-kit/hono
const { response, channel, restaleKitRequestId } = toSSEResponse(request)
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
  restaleKitRequestId: string
  roles: string[]
}
const typedGroup = new SSEChannelGroup<InvalidateSignal, ClientMeta>()
```

**Constructor options:**

| Option | Type | Description |
|---|---|---|
| `metaSchema` | `StandardSchema` | Validates metadata on `register()`. Throws `SchemaValidationError` on failure. |
| `pubsub` | `PubSubAdapter` | Distributed pub/sub adapter for multi-instance deployments. See [Pub/Sub guide](./pubsub.md). |
| `eventBufferCapacity` | `number` | Enables Last-Event-ID history replay buffer up to `N` events. |
| `controlTopic` | `string` | Custom control topic name for cross-cluster revocations (default: `'__restale_control__'`). |

---

## `register` and `deregister`

```ts
group.register(channel, meta)
group.register(channel, meta, { topics: ['user:42', 'global'] }) // for pub/sub routing

group.deregister(channel)
```

- `meta` can be any value; its type is inferred from the group's `TMeta` generic. Always include `restaleKitRequestId` extracted from transport adapters.
- `topics` is an optional list of pub/sub topic strings this connection subscribes to. Only relevant when using a pub/sub adapter.

**Ownership of cleanup:** Adapters automatically detect when a peer disconnects and call `channel.disconnect()` to close the underlying transport stream — you do not need to call that yourself. However, you **must** call `group.deregister(channel)` in your route handler's close/abort listener to remove the channel from the group's broadcast list.

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

---

## Connection Revocation (`revoke()`)

Use `group.revoke(criteria)` to actively close active client connections (e.g. on logout, session expiration, or user ban).

`revoke` uses **subset-matching** against registered connection metadata (`matchesJSONValue`):

```ts
// 1. Single-connection logout. `userId` and `sessionId` come from trusted
// authentication/session middleware; `requestId` is only a client correlation value.
await group.revoke({
  userId: req.user.id,
  sessionId: req.session.id,
  restaleKitRequestId: req.body.requestId,
})

// 2. User-wide ban / logout everywhere (closes ALL sessions for user-42 across the entire cluster)
await group.revoke({ userId: 'user-42' })
```

### Security: always scope client-supplied request IDs

`restaleKitRequestId` is generated as a UUID by the client package and is useful for correlating a logout request with one SSE connection. It is **not** an authentication credential: a client can submit any value to an HTTP endpoint. Do not use a bare `revoke({ restaleKitRequestId: req.body.requestId })` call in a request handler.

Register trusted identity metadata from your authentication layer (at least `userId`; use a server-authenticated `sessionId` when available), then include that metadata in the revocation criteria. This ensures that an arbitrary or leaked request ID cannot revoke a connection outside the authenticated user's/session's scope. UUID unguessability reduces accidental discovery, but is not authorization.

If the client does not send a per-connection request ID, revoke the trusted session instead; this may close more than one tab:

```ts
await group.revoke({
  userId: req.user.id,
  sessionId: req.session.id,
})
```

When a pub/sub adapter is configured, `revoke()` automatically broadcasts control messages across the cluster to reach matching connections on other server instances.

---

## Reconnection & Event History Replay

To prevent missed invalidation signals during momentary network drops, configure `eventBufferCapacity`:

```ts
const group = new SSEChannelGroup({
  eventBufferCapacity: 100, // Retain the last 100 invalidation events
})
```

When a client reconnects sending the standard `Last-Event-ID` HTTP header, `restale-kit` automatically queries the `eventStore` and replays all missed invalidation events in sequence before resuming live stream comments.

---

## Teardown (`dispose()`)

Call `group.dispose()` during graceful server shutdown to unsubscribe control topic listeners without force-closing client channels:

```ts
process.on('SIGTERM', async () => {
  await group.dispose()
  server.close()
})
```
