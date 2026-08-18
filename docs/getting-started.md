# Getting Started

> **What it does:** After a DB write on the server, call `channel.invalidate()`. Every connected browser client automatically refetches its stale queries. No polling, no websockets.

---

## Prerequisites

- **Node.js**: `>=18.0.0` (uses native Web Streams `ReadableStream`, Web Fetch API, `EventTarget`, and ES2024 features).

---

## Installation

```sh
npm install restale-kit
```

Install peer dependencies for your stack:

```sh
# Using TanStack Query (React)
npm install @tanstack/react-query react

# Using SWR
npm install swr

# Distributed pub/sub (pick one)
npm install ioredis    # Redis
npm install ably       # Ably
npm install pusher     # Pusher
```

All peers are optional — only install what you use.

> [!IMPORTANT]
> **Deploying to Next.js or Serverless?**
> - [ ] Instance created once in a shared module (`lib/restale.ts`)
> - [ ] Cached via `globalThis` in development mode to prevent leaks during HMR
> - [ ] Never instantiated inside a route handler or component body
> - 👉 Check the [Next.js & Serverless Guide](./nextjs.md) for full patterns.

---

## 5-minute setup: Express + TanStack Query

### 1. Server

```ts
import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'

const app = express()
app.use(express.json())

const group = new SSEChannelGroup()

// SSE endpoint — clients connect here
app.get('/sse', (req, res) => {
  group.attachNodeResponse(req, res, {})
})

// After any mutation, broadcast the invalidation
app.post('/api/todos', async (req, res) => {
  // ... write to DB ...
  group.broadcastToAll({ key: ['todos'] })
  res.status(201).json({ success: true })
})

app.listen(3000)
```

> **Manual debugging with curl:**
> When connecting manually, you will receive an initial `connected` frame carrying your auto-generated connection ID, followed by any broadcast events:
>
> ```sh
> curl -N "http://localhost:3000/sse"
> # Output:
> # event: connected
> # data: {"connectionId":"d290f1ee-6c54-4b01-90e6-d701748f0851"}
> ```

### 2. Client (React + TanStack Query)

```tsx
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { RestaleProvider, useRestale } from 'restale-kit/react'
import { tanstackQueryAdapter } from 'restale-kit/tanstack-query'

const queryClient = new QueryClient()
const onInvalidate = tanstackQueryAdapter(queryClient)

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RestaleProvider url="/sse" onInvalidate={onInvalidate}>
        <TodoList />
      </RestaleProvider>
    </QueryClientProvider>
  )
}

function TodoList() {
  const { isConnected } = useRestale()
  const { data: todos } = useQuery({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then(r => r.json()),
  })

  return <ul>{todos?.map(t => <li key={t.id}>{t.title}</li>)}</ul>
}
```

That's it. When the server calls `group.broadcastToAll({ key: ['todos'] })`, every connected client's active `['todos']` queries are marked stale and immediately refetched. Inactive queries (no active observers) are marked stale and will refetch the next time they are observed.

> **Heads up — per-user invalidation and revocation:** The example above registers channels without metadata (`group.attachNodeResponse(req, res, {})`). This works for `broadcastToAll`, but it means you can't use `broadcast((meta) => ...)` to target specific users, and `revokeWhere({ userId })` won't match these channels. If you plan to send per-user signals or revoke connections on logout, register each channel with metadata up front:
>
> ```ts
> app.use(authMiddleware) // auth middleware populates req.user
>
> app.get('/sse', (req, res) => {
>   group.attachNodeResponse(req, res, {
>     meta: { userId: req.user.id }, // ← add metadata now
>   })
> })
> ```
>
> See [Server guide → Broadcasting](./server.md#broadcasting) and [Connection Revocation](./server.md#connection-revocation) for details.

---

## Next steps

- **Other server frameworks (Hono, Fastify, Node)** → [Server guide](./server.md)
- **Next.js & Serverless patterns (App Router, HMR singleton)** → [Next.js & Serverless guide](./nextjs.md)
- **SWR, vanilla JS client** → [Client guide](./client.md)
- **Per-user invalidation, metadata filtering** → [Server guide → Broadcasting](./server.md#broadcasting)
- **Zod / Standard Schema validation** → [Validation guide](./validation.md)
- **Multi-instance / serverless scaling** → [Pub/Sub guide](./pubsub.md)
