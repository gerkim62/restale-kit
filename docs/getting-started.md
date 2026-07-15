# Getting Started

> **What it does:** After a DB write on the server, call `channel.invalidate()`. Every connected browser client automatically refetches its stale queries. No polling, no websockets.

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

---

## 5-minute setup: Express + TanStack Query

### 1. Server

```ts
import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/express'

const app = express()
app.use(express.json())

const group = new SSEChannelGroup()

// SSE endpoint — clients connect here
app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  group.register(channel)
})

// After any mutation, broadcast the invalidation
app.post('/api/todos', async (req, res) => {
  // ... write to DB ...
  group.broadcastToAll({ key: ['todos'] })
  res.status(201).json({ success: true })
})

app.listen(3000)
```

> **Note:** `attachSSE` requires the `restaleKitRequestId` query parameter on the request URL. The `restale-kit` client SDK (`useReStale`, `SSEInvalidatorClient`) appends this automatically — you never set it manually. If you open the SSE endpoint directly in a browser or with curl, you'll get an error; always connect through the client library.

### 2. Client (React + TanStack Query)

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useReStale } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'

function App() {
  const queryClient = useQueryClient()

  // Connect to SSE; automatically invalidates queries on signal
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

That's it. When the server calls `group.broadcastToAll({ key: ['todos'] })`, every connected client's active `['todos']` queries are marked stale and immediately refetched. Inactive queries (no active observers) are marked stale and will refetch the next time they are observed.

---

## Next steps

- **Other server frameworks (Hono, Fastify, Node)** → [Server guide](./server.md)
- **SWR, vanilla JS client** → [Client guide](./client.md)
- **Per-user invalidation, metadata filtering** → [Server guide → Broadcasting](./server.md#broadcasting)
- **Zod / Standard Schema validation** → [Validation guide](./validation.md)
- **Multi-instance / serverless scaling** → [Pub/Sub guide](./pubsub.md)
