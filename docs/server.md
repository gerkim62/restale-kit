# Server Guide

The server side of `restale-kit` manages incoming client SSE streams via framework adapters, tracks connection metadata, and broadcasts cache-invalidation signals when backend mutations occur.

For authentication practices, see [Security Guide](./security.md). For multi-instance scaling, see [Pub/Sub Guide](./pubsub.md).

---

## 1. `SSEChannelGroup` Options

`SSEChannelGroup` is the central manager for server-side connections.

```ts
const group = new SSEChannelGroup(options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `target` | `SignalTarget \| SignalTarget[]` | `undefined` | Target discriminator(s) for automatic signal tagging across channels in this group. |
| `metaSchema` | `StandardSchemaV1` | `undefined` | Standard Schema (Zod, Valibot, ArkType) for validating metadata passed to `attachNodeResponse` or `createFetchResponse`. |
| `pubsub` | `PubSubAdapter` | `undefined` | Distributed pub/sub adapter (Redis, Ably, Pusher) for multi-instance scaling. |
| `eventStore` | `EventStore` | `undefined` | Shared history store for recording frames and replaying missed events via `Last-Event-ID`. |
| `eventBufferCapacity` | `number` | `undefined` | Capacity for automatic event store instantiation when `eventStore` is omitted. |
| `controlTopic` | `string` | `'__restale_control__'` | Pub/sub channel name used for cluster-wide control signals (e.g. revocation). |
| `channelDefaults` | `ChannelDefaults` | `undefined` | Default configuration (`keepaliveIntervalMs`, `retryIntervalMs`, `lifetime`, `beforeFrame`, `guardKeepalive`) applied to all channels. |

---

## 2. Framework Adapters

### Express

```ts
import express from 'express'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const app = express()
const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

app.get('/api/sse', (req, res) => {
  group.attachNodeResponse(req, res)
})
```

### Fastify

`group.attachNodeResponse` accepts Fastify's `request` and `reply` objects and automatically invokes `reply.hijack()` to take control of the underlying socket.

```ts
import Fastify from 'fastify'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const app = Fastify()
const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

app.get('/api/sse', (request, reply) => {
  group.attachNodeResponse(request, reply)
})
```

> **Note:** Do not call `reply.hijack()` manually before calling `attachNodeResponse`. `attachNodeResponse` handles socket hijacking safely.

### Node `http`

```ts
import http from 'node:http'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  if (req.method === 'GET' && url.pathname === '/api/sse') {
    group.attachNodeResponse(req, res)
  }
})
```

### Hono

Fetch-based runtimes return `{ response, channel }`. Return `response` from your route handler.

```ts
import { Hono } from 'hono'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const app = new Hono()
const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

app.get('/api/sse', (c) => {
  const { response } = group.createFetchResponse(c.req.raw)
  return response
})
```

### Bun

```ts
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/api/sse') {
      const { response } = group.createFetchResponse(req)
      return response
    }
    return new Response('Not Found', { status: 404 })
  },
})
```

### Deno

```ts
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

Deno.serve((req) => {
  const url = new URL(req.url)
  if (url.pathname === '/api/sse') {
    const { response } = group.createFetchResponse(req)
    return response
  }
  return new Response('Not Found', { status: 404 })
})
```

### Cloudflare Workers

```ts
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url)
    if (url.pathname === '/api/sse') {
      const { response } = group.createFetchResponse(request)
      return response
    }
    return new Response('Not Found', { status: 404 })
  },
}
```

### Next.js Edge Route Handler

```ts
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

export const runtime = 'edge'

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

export function GET(request: Request): Response {
  const { response } = group.createFetchResponse(request)
  return response
}
```

---

## 3. Broadcasting

`SSEChannelGroup` provides three broadcasting methods for delivering invalidation signals to connected clients:

### `broadcastToAll(signal)`
Sends an invalidation signal to every active channel in the group.

```ts
group.broadcastToAll({ queryKey: ['posts'] })
```

### `broadcast(signal, predicate)`
Evaluates a predicate function against each channel's registered metadata (`meta`), delivering the signal only when the predicate returns `true`.

```ts
group.broadcast(
  { queryKey: ['orders'] },
  (meta) => meta.role === 'admin'
)
```

### `broadcastByKey(key, signal)`
Convenience helper that broadcasts to channels matching a key-value pair in metadata (`meta[key] === value`).

```ts
group.broadcastByKey('userId', 'user_123', { queryKey: ['profile'] })
```

---

## 4. Per-User Invalidation

Attach user metadata during channel registration to route invalidations to specific authenticated users:

```ts
import express from 'express'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

interface UserMeta {
  userId: string
  tenantId: string
}

const app = express()
const group = new SSEChannelGroup<InvalidateSignal, UserMeta>({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

// Authentication middleware populates req.user
app.get('/api/sse', (req, res) => {
  const userId = req.headers['x-user-id'] as string
  const tenantId = req.headers['x-tenant-id'] as string

  group.attachNodeResponse(req, res, {
    meta: { userId, tenantId },
  })
})

// Target a single user
app.post('/api/user/update', (req, res) => {
  const targetUserId = req.body.userId
  group.broadcast(
    { queryKey: ['user', targetUserId] },
    (meta) => meta.userId === targetUserId
  )
  res.json({ success: true })
})
```

---

## 5. Connection Revocation

Revocation forcibly closes an active client SSE stream from the server and signals the client to suppress automatic reconnection attempts.

### `revokeByConnectionId(connectionId, reason?)`
Closes all channels matching a specific connection ID (`__restale_cid__`).

```ts
await group.revokeByConnectionId(connectionId, 'logout')
```

### `revokeWhere(predicate, reason?)`
Closes all channels whose metadata satisfies the predicate function.

```ts
await group.revokeWhere(
  (meta) => meta.userId === 'user_123',
  'session-expired'
)
```

When a channel is revoked, a `revoke` event frame is sent to the client carrying the specified reason string before the stream terminates.

---

## 6. Event Replay & `Last-Event-ID`

When client network connections drop and reconnect, the browser automatically sends the `Last-Event-ID` HTTP header containing the last received frame ID. `SSEChannelGroup` can replay missed invalidation signals upon connection resume.

To enable event replay, configure an event store capacity:

```ts
const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
  eventBufferCapacity: 100, // Retains the last 100 invalidation events
})
```

When a client resumes with a `Last-Event-ID` header, `SSEChannelGroup` looks up missed signals from the event buffer and replays them immediately before resuming live event streaming.

---

## 7. Keepalive

By default, keepalive comments are disabled (`keepaliveIntervalMs: 0`). To prevent intermediate proxies, firewalls, or load balancers from timing out idle connections, configure a keepalive interval in milliseconds:

```ts
const group = new SSEChannelGroup({
  channelDefaults: {
    target: SIGNAL_TARGETS.TANSTACK_QUERY,
    keepaliveIntervalMs: 15_000, // Emits `: keepalive` frame every 15 seconds
  },
})
```
