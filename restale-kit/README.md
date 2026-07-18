# ⚡️ restale-kit

[![npm version](https://img.shields.io/npm/v/restale-kit.svg?style=flat-down)](https://www.npmjs.com/package/restale-kit)
[![license](https://img.shields.io/npm/l/restale-kit.svg?style=flat-down)](https://github.com/gerkim62/restale-kit/blob/main/LICENSE)
[![ESM-only](https://img.shields.io/badge/module-ESM--only-blue.svg?style=flat-down)](https://nodejs.org/api/esm.html)

Push cache-invalidation signals from your server to every connected client over **Server-Sent Events**. TanStack Query and SWR automatically refetch when your data changes — no polling, no websockets, no manual cache busting.

One job, done exceptionally well.

---

## 🧭 Mental Model

```mermaid
flowchart LR
    subgraph Server ["Server (Node / Hono / Express / Fastify)"]
        db[(DB Write)] --> app[App Logic]
        app --> group[SSEChannelGroup]
        group --> wire((SSE Stream))
    end
    subgraph Client ["Client (React / Vanilla JS)"]
        wire --> client[useReStale / SSEInvalidatorClient]
        client --> adapter[tanstackAdapter / swrAdapter]
        adapter --> cache[TanStack Query / SWR]
        cache --> ui[UI Rerender]
    end
```

---

## ✨ Features

- **Framework agnostic:** Zero runtime dependencies in core. Works in any JS environment.
- **First-class server adapters:** Express, Fastify, Hono, Node `http`, and any Fetch-API runtime (Bun, Deno, Cloudflare Workers, Vercel Edge).
- **First-class client adapters:** TanStack Query, SWR, and a React hook (`useReStale`) for zero-boilerplate wiring.
- **Precision invalidation:** Hierarchical key matching with prefix, exact, and object-subset semantics.
- **Optional Standard Schema validation:** Zod, Valibot, ArkType, etc. — type-safe signals and metadata at compile and runtime.
- **Horizontally scalable:** Built-in pub/sub adapters for Redis, Ably, and Pusher.
- **Robust reconnection:** Exponential backoff with jitter; configurable retries.

---

## 📦 Installation

```sh
npm install restale-kit
```

Install optional integration dependencies for your stack:

```sh
npm install @tanstack/react-query react   # TanStack Query
npm install swr                           # SWR
npm install ioredis                       # Redis pub/sub
npm install ably                          # Ably pub/sub
npm install pusher                        # Pusher pub/sub
```

---

## 🗺️ Import Map

| Subpath | Contents |
|---|---|
| `restale-kit` | `JSONValue`, `InvalidateSignal`, `ChannelClosedError`, `SchemaValidationError` |
| `restale-kit/server` | `createSSEChannel`, `SSEChannelGroup` |
| `restale-kit/node` | `attachSSE` (Node `http`) |
| `restale-kit/express` | `attachSSE` |
| `restale-kit/fastify` | `attachSSE` (auto-calls `reply.hijack()` when passed Fastify objects) |
| `restale-kit/fetch` | `toSSEResponse` (Bun, Deno, Cloudflare Workers) |
| `restale-kit/hono` | `toSSEResponse` |
| `restale-kit/client` | `SSEInvalidatorClient` |
| `restale-kit/react` | `useReStale` |
| `restale-kit/tanstack-query` | `tanstackAdapter`, `useTanstackQueryAdapter` |
| `restale-kit/swr` | `swrAdapter`, `useSwrAdapter` |
| `restale-kit/pubsub` | `PubSubAdapter` interface |
| `restale-kit/redis` | `redisPubSubAdapter` |
| `restale-kit/ably` | `ablyPubSubAdapter` |
| `restale-kit/pusher` | `pusherPubSubAdapter` |

---

## 🚀 Quick Start

### Server (Express)

```ts
import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/express'

const app = express()
app.use(express.json())

const group = new SSEChannelGroup()

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  group.register(channel, {
    userId: req.user.id,
    sessionId: req.session.id,
  })
})

app.post('/api/todos', async (req, res) => {
  // ... write to DB ...
  group.broadcastToAll({ key: ['todos'] })
  res.status(201).json({ success: true })
})

// Revoke one connection. Scope the client-supplied request ID with trusted
// identity/session values from authentication middleware.
app.post('/api/logout', async (req, res) => {
  await group.revokeByConnectionId(req.body.connectionId, {
    userId: req.user.id,
    sessionId: req.session.id,
  })
  res.json({ success: true })
})

app.listen(3000)
```

### Client (React + TanStack Query)

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useReStale } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'

function App() {
  const queryClient = useQueryClient()

  useReStale('/sse', {
    onInvalidate: tanstackAdapter(queryClient),
  })

  const { data: todos } = useQuery({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then(r => r.json()),
  })

  return <ul>{todos?.map(t => <li key={t.id}>{t.title}</li>)}</ul>
}
```

---

## 🛠️ Other Server Frameworks

### Hono / Bun / Deno / Edge

```ts
import { Hono } from 'hono'
import { SSEChannelGroup } from 'restale-kit/server'
import { toSSEResponse } from 'restale-kit/hono'

const app = new Hono()
const group = new SSEChannelGroup()

app.get('/sse', (c) => {
  const { response, channel } = toSSEResponse(c.req.raw)
  group.register(channel)
  return response
})
```

### Fastify

```ts
import { attachSSE } from 'restale-kit/fastify'

app.get('/sse', (request, reply) => {
  // Pass request/reply directly — reply.hijack() is called automatically
  const channel = attachSSE(request, reply)
  group.register(channel)
})
```

### Native Node.js

```ts
import { attachSSE } from 'restale-kit/node'

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  if (req.method === 'GET' && url.pathname === '/sse') {
    const channel = attachSSE(req, res)
    group.register(channel)
  }
})
```

---

## 🎯 Invalidation Signals & Key Matching

`InvalidateSignal` is a **discriminated union** — choose the shape that matches your cache client:

```ts
// TanStack Query — uses queryKey + rich action set
type TanStackQuerySignal = {
  target: 'tanstack-query'
  queryKey: JSONValue[]
  exact?: boolean
  type?: 'all' | 'active' | 'inactive'
  action?: 'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel'  // default 'invalidate'
  stale?: boolean
}

// SWR — uses key + SWR-native actions
type SWRSignal = {
  target: 'swr'
  key: string | JSONValue[]
  action?: 'revalidate' | 'purge' | 'remove'  // default 'revalidate'
  revalidate?: boolean
  match?: 'exact' | 'prefix'
}

// RTK Query — tag-based invalidation (wire protocol only; no shipped adapter)
type RTKQuerySignal = {
  target: 'rtk-query'
  tags: Array<string | { type: string; id?: string | number }>
}

// Generic fallback — for raw SSE listeners or custom integrations
type GenericInvalidateSignal = {
  target?: 'generic'
  key: JSONValue[]
  exact?: boolean
  action?: 'invalidate' | 'refetch' | 'remove'  // default 'invalidate'
}

type InvalidateSignal =
  | TanStackQuerySignal
  | SWRSignal
  | RTKQuerySignal
  | GenericInvalidateSignal
```

> See [`docs/api-reference.md`](https://github.com/gerkim62/restale-kit/blob/main/docs/api-reference.md) for the full type signatures.

**Key matching (prefix mode, `exact: false`):**

Given cache key `['todos', { userId: 4, type: 'active' }]`:

| Signal key | Matches? |
|---|---|
| `['todos']` | ✅ prefix |
| `['todos', { userId: 4 }]` | ✅ object subset |
| `['todos', { userId: 4, type: 'active' }]` | ✅ exact match |
| `['todos', { userId: 4, label: 'work' }]` | ❌ unknown property |
| `[]` | ✅ matches everything |

**`GenericInvalidateSignal` actions** (used when `target` is `'generic'` or omitted):

| `action` | TanStack Query | Raw client |
|---|---|---|
| `'invalidate'` (default) | `invalidateQueries` | custom handler |
| `'refetch'` | `refetchQueries` | custom handler |
| `'remove'` | `removeQueries` | custom handler |

**`TanStackQuerySignal` actions** (additional actions available via the `target: 'tanstack-query'` shape):

| `action` | TanStack Query |
|---|---|
| `'invalidate'` (default) | `invalidateQueries` |
| `'refetch'` | `refetchQueries` |
| `'reset'` | `resetQueries` |
| `'remove'` | `removeQueries` |
| `'cancel'` | `cancelQueries` |

**`SWRSignal` actions** (used via `target: 'swr'`):

| `action` | SWR |
|---|---|
| `'revalidate'` (default) | `mutate(filter)` |
| `'purge'` | `mutate(filter, undefined, { revalidate: false })` |
| `'remove'` | `mutate(filter, undefined, { revalidate: false })` — alias for `'purge'`, clears matching keys without revalidating |

**Broadcasting:**

```ts
// Broadcast to all connected clients
group.broadcastToAll({ key: ['todos'] })

// Broadcast to clients matching a predicate
group.broadcast(
  { key: ['todos', { userId: 42 }] },
  (meta) => meta.userId === 42
)

// Broadcast using automatic key-based matching
// Scalar or plain-object metadata is auto-wrapped into [meta] for key matching
group.broadcastByKey({ key: ['todos', { userId: 42 }] })
```

---

## 🔌 Vanilla JS / Non-React Client

```ts
import { SSEInvalidatorClient } from 'restale-kit/client'

const client = new SSEInvalidatorClient('/sse', {
  autoReconnect: true,
  withCredentials: false, // set true for cross-origin with cookie auth
})

client.addEventListener('invalidate', (event) => {
  const signal = event.detail // InvalidateSignal | InvalidateSignal[]
})

client.addEventListener('statuschange', (event) => {
  const status = event.detail // ConnectionStatus — a discriminated union
  if (status.status === 'closed') {
    console.log('closed, reason:', status.reason) // 'manual' | 'unmount' | 'revoked'
  } else if (status.status === 'error') {
    console.log('error event:', status.error)     // Event
  } else {
    console.log(status.status)                    // 'connecting' | 'open'
  }
})

await client.connect()
```

---

## 🛡️ Standard Schema Validation (Optional)

Pass a Zod (or any Standard Schema-compatible) schema to enforce types at compile time and validate at runtime.

**Server:**
```ts
import { z } from 'zod'

const AppSignalSchema = z.object({
  key: z.union([
    z.tuple([z.literal('todos')]),
    z.tuple([z.literal('todos'), z.object({ userId: z.string() })]),
  ]),
  exact: z.boolean().optional(),
  action: z.enum(['invalidate', 'refetch', 'remove']).optional(),
})
type AppSignal = z.infer<typeof AppSignalSchema>

const group = new SSEChannelGroup<AppSignal>()

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res, { signalSchema: AppSignalSchema })
  group.register(channel)
})

group.broadcastToAll({ key: ['todos'] })           // ✅ valid
// group.broadcastToAll({ key: ['posts'] })        // ❌ TypeScript error
```

**Client:**
```tsx
useReStale<AppSignal>('/sse', {
  signalSchema: AppSignalSchema,
  onInvalidate: tanstackAdapter(queryClient),
})
```

→ Full guide: [Validation](https://github.com/gerkim62/restale-kit/blob/main/docs/validation.md)

---

## 🌐 Distributed Pub/Sub & Connection Revocation

When scaling across multiple instances or serverless functions, use a pub/sub adapter to coordinate invalidations and connection revocations:

```ts
import Redis from 'ioredis'
import { redisPubSubAdapter } from 'restale-kit/redis'

const group = new SSEChannelGroup({
  // Enforces symmetric encryption for message payloads sent to the provider.
  // We recommend generating a key of 32+ bytes of entropy via a CSPRNG (e.g. base64 or hex encoded, not a human-chosen passphrase).
  pubsub: redisPubSubAdapter(new Redis(process.env.REDIS_URL), {
    encryptionKey: process.env.PUBSUB_ENCRYPTION_KEY!,
  }),
})


app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  group.register(channel, {
    userId: req.user.id,
    sessionId: req.session.id,
  }, {
    topics: [`user:${req.user.id}`],
  })
})

// Publish invalidations across cluster
await group.publish(`user:${userId}`, { key: ['todos'] })

// Revoke one connection across the cluster. `userId` and `sessionId` come
// from authenticated server state; `connectionId` is the client correlation value.
async function logoutUserConnection(userId: string, sessionId: string, connectionId: string) {
  await group.revokeByConnectionId(connectionId, { userId, sessionId })
}

// Revoke all sessions across cluster (ban / logout everywhere)
await group.revokeWhere({ userId: 'user-123' })
```

Also available: `ablyPubSubAdapter` and `pusherPubSubAdapter`.

> **Security:** `connectionId` is a UUID generated by the client to correlate one SSE connection. It is not an authentication credential; a client can submit an arbitrary value. When revoking from a request handler, always combine it with trusted metadata such as `userId` and a server-authenticated `sessionId`. UUID unguessability is not authorization.
>
> **No Mixed-Mode Support**: You cannot mix encrypted and unencrypted publishers/subscribers in the same cluster. Mismatched messages are dropped. This constraint is critical to prevent an attacker with access to the pub/sub broker from injecting plain unencrypted payloads to bypass decryption and tamper with client invalidation states.

→ Full guide: [Pub/Sub](https://github.com/gerkim62/restale-kit/blob/main/docs/pubsub.md)

---

## ⚙️ API Quick Reference

### `useReStale(url, options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `onInvalidate` | `(signal) => void` | — | **Required.** Called on each signal. |
| `onRevoke` | `(reason: string) => void` | `undefined` | Called when the server sends a terminal revoke frame. The connection will NOT auto-reconnect. |
| `autoReconnect` | `boolean \| AutoReconnectOptions` | `true` | Auto-reconnect on disconnect. Pass `boolean` or `{ native?: boolean, jsBackoff?: boolean }` for granular control. |
| `signalSchema` | `StandardSchemaV1` | `undefined` | Validate incoming signals with Zod / Valibot / ArkType. |
| `withCredentials` | `boolean` | `false` | Pass cookies / auth headers to EventSource. |
| `disabled` | `boolean` | `false` | Prevent connection. |
| `debug` | `boolean` | `false` | Enable verbose console debug logging for connection lifecycle events. |
| `reconnect.baseDelayMs` | `number` | `1000` | Initial retry delay. |
| `reconnect.maxDelayMs` | `number` | `30000` | Max retry delay. |
| `reconnect.jitter` | `boolean` | `true` | Randomise delay. |
| `reconnect.maxRetries` | `number` | `Infinity` | Give up after N retries. |
| `target` | `SignalTarget` | `undefined` | Optional target discriminator ('tanstack-query' | 'swr' | 'rtk-query' | 'generic') expected by the client. |

### `createSSEChannel(options?)` / `attachSSE(req, res, options?)` / `toSSEResponse(request, options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `keepaliveIntervalMs` | `number` | `0` (disabled) | Periodic keepalive comment interval in ms (`: keepalive\n\n`) to prevent proxy/CDN connection drops (disabled by default). |
| `retryIntervalMs` | `number` | `undefined` | Retry delay in ms sent as a `retry: <ms>` frame on stream start. |
| `signalSchema` | `StandardSchemaV1` | `undefined` | Standard Schema to validate signals passed to `channel.invalidate()`. |
| `lastEventId` | `string` | `undefined` | Last event ID received from client header (`Last-Event-ID`). |
| `eventStore` | `EventStore` | `undefined` | Shared EventStore for history replay upon reconnect. |
| `eventBufferCapacity` | `number` | `undefined` | Capacity of automatically instantiated EventStore ring buffer. |
| `idGenerator` | `() => string` | auto-increment | Custom event ID generator for assigned event frames. Caller-supplied or generated IDs can be emitted without an event store, but cannot be replayed without history. |
| `connectionId` | `string` | `''` | Extracted automatically from `__restale_cid__` by transport adapters (`attachSSE`, `toSSEResponse`). You never need to set or manage this parameter manually. |
| `target` | `SignalTarget \| SignalTarget[]` | `undefined` | Target discriminator (`'tanstack-query'`, `'swr'`, `'rtk-query'`, `'generic'`) for signal type safety, HTTP header emission (`X-ReStale-Target`), and automatic multi-target fanout. |

### `SSEChannelGroup(options?)`

| Option | Description |
|---|---|
| `metaSchema` | Validates connection metadata on `register()`. |
| `pubsub` | Pub/sub adapter for multi-instance scaling. |
| `eventBufferCapacity` | Enables Last-Event-ID event history replay buffer. |
| `eventStore` | Custom event store for persistent or externally managed replay storage. |
| `controlTopic` | Control topic for cross-cluster revocations (default `'__restale_control__'`). |

### `attachSSE(req, res, options?)` / `toSSEResponse(request, options?)`

| Method | Returns | Description |
|---|---|---|
| `attachSSE(req, res, options?)` | `SSEChannel<TSignal>` | Attaches SSE stream to Node HTTP response. For `restale-kit/fastify`, pass `request`/`reply` directly — `reply.hijack()` is called automatically. |
| `toSSEResponse(request, options?)` | `{ response: Response, channel: SSEChannel<TSignal> }` | Creates Fetch API SSE response object. |

### `channel.invalidate(signal, customId?)`

Returns a `string` — the SSE event ID assigned to the invalidation frame. This is only meaningful when `eventBufferCapacity` or a custom `eventStore` is configured: the client echoes the ID back as `Last-Event-ID` on reconnect and `restale-kit` replays any missed events. If neither `eventBufferCapacity` nor `eventStore` is configured, the return value is `''` and can be ignored.

→ Full API: [API Reference](https://github.com/gerkim62/restale-kit/blob/main/docs/api-reference.md)

---

## 📚 Documentation

- [Getting Started](https://github.com/gerkim62/restale-kit/blob/main/docs/getting-started.md)
- [Server Guide](https://github.com/gerkim62/restale-kit/blob/main/docs/server.md)
- [Client Guide](https://github.com/gerkim62/restale-kit/blob/main/docs/client.md)
- [Validation Guide](https://github.com/gerkim62/restale-kit/blob/main/docs/validation.md)
- [Pub/Sub Guide](https://github.com/gerkim62/restale-kit/blob/main/docs/pubsub.md)
- [API Reference](https://github.com/gerkim62/restale-kit/blob/main/docs/api-reference.md)

---

## 📄 License

MIT © [Gerison Kimathi](https://github.com/gerkim62)
