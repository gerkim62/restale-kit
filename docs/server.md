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
  const channel = attachSSE(req, res)
  group.register(channel, {})
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
  if (req.url === '/sse' && req.method === 'GET') {
    const channel = attachSSE(req, res)
    group.register(channel, {})
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
  const channel = attachSSE(request.raw, reply.raw)
  group.register(channel, {})
  request.raw.on('close', () => group.deregister(channel))
})
```

### Hono (Cloudflare Workers, Bun, Deno, edge)

Fetch-API runtimes use an inverted response model — `toSSEResponse` returns both the `Response` to hand back to the framework and the `SSEChannel` to call `invalidate()` on.

```ts
import { Hono } from 'hono'
import { SSEChannelGroup } from 'restale-kit/server'
import { toSSEResponse } from 'restale-kit/hono'

const app = new Hono()
const group = new SSEChannelGroup()

app.get('/sse', (c) => {
  const { response, channel } = toSSEResponse(c.req.raw)
  group.register(channel, {})
  c.req.raw.signal.addEventListener('abort', () => group.deregister(channel))
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

`SSEChannelGroup` manages all connected clients and is where you send invalidation signals.

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
| `metaSchema` | `StandardSchema` | Validates metadata on `register()`. Throws `SchemaValidationError` on failure. |
| `pubsub` | `PubSubAdapter` | Distributed pub/sub adapter for multi-instance deployments. See [Pub/Sub guide](./pubsub.md). |

---

## `register` and `deregister`

```ts
group.register(channel, meta)
group.register(channel, meta, { topics: ['user:42', 'global'] }) // for pub/sub routing

group.deregister(channel)
```

- `meta` can be any value; its type is inferred from the group's `TMeta` generic.
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

### Signal shape

```ts
interface InvalidateSignal {
  key: JSONValue[]           // hierarchical key, e.g. ['todos', { userId: '42' }]
  exact?: boolean            // true = exact match, false (default) = prefix match
  action?: 'invalidate' | 'refetch' | 'remove'  // default: 'invalidate'
}
```

**Actions:**

| Action | Effect on TanStack Query | Effect on SWR |
|---|---|---|
| `'invalidate'` (default) | `queryClient.invalidateQueries()` — mark stale, refetch if active | `mutate(filter)` — revalidate |
| `'refetch'` | `queryClient.refetchQueries()` — force immediate refetch | `mutate(filter)` — revalidate |
| `'remove'` | `queryClient.removeQueries()` — purge from cache | `mutate(filter, undefined, false)` — clear without revalidate |

### Key matching semantics

Signal keys use **hierarchical prefix matching** by default (`exact: false`).

Given a client cache key `['todos', { userId: 4, type: 'active' }, 'list']`:

| Signal key | `exact` | Matches? |
|---|---|---|
| `['todos']` | false | ✅ prefix match |
| `['todos', { userId: 4 }]` | false | ✅ object subset match |
| `['todos', { userId: 4, type: 'active' }]` | false | ✅ exact object match |
| `['todos', { userId: 4, label: 'work' }]` | false | ❌ unknown property |
| `['todos', { userId: 4, type: 'active' }, 'list']` | true | ✅ exact match |
| `['todos']` | true | ❌ length mismatch |
| `[]` | false | ✅ matches everything |

---

## `publish(topic, signal)` — pub/sub routing

When using a pub/sub adapter for multi-instance deployments, use `publish` instead of `broadcast`:

```ts
// Publish to a topic — reaches all instances with subscribers on that topic
await group.publish(`user:${userId}`, { key: ['todos'] })
```

See the [Pub/Sub guide](./pubsub.md) for full setup details.

---

## `createSSEChannel` (low-level)

You normally don't need this — framework adapters call it for you. Use it only when writing a custom transport.

```ts
import { createSSEChannel } from 'restale-kit/server'

const channel = createSSEChannel({
  keepaliveIntervalMs: 30_000, // default
  signalSchema: MyZodSchema,   // optional
})

// channel.stream: ReadableStream<Uint8Array> — pipe into your response
// channel.invalidate(signal): void
// channel.close(): void
// channel.disconnect(): void  — call when peer disconnects
```

---

## Error handling

- **`ChannelClosedError`** — thrown by `channel.invalidate()` if called after the channel is closed. `SSEChannelGroup` catches this automatically and deregisters the channel.
- **`SchemaValidationError`** — thrown when signal or metadata validation fails (only when a schema is configured). Contains `.issues` for programmatic access.
- **`AggregateError`** — thrown by `broadcast` / `broadcastToAll` if any channel encounters a non-`ChannelClosedError` (e.g. `SchemaValidationError`). Iteration always completes before throwing.

---

## Connection metadata patterns

```ts
// Typed metadata for auth context
interface ClientMeta {
  userId: string
  tenantId: string
  roles: string[]
}

const group = new SSEChannelGroup<InvalidateSignal, ClientMeta>()

app.get('/sse', (req, res) => {
  // Populate from your auth middleware
  const channel = attachSSE(req, res)
  group.register(channel, {
    userId: req.user.id,
    tenantId: req.user.tenantId,
    roles: req.user.roles,
  })
  req.on('close', () => group.deregister(channel))
})

// Later — per-tenant invalidation
group.broadcast(
  { key: ['products'] },
  (meta) => meta.tenantId === '...'
)
```
