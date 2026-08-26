# Getting Started with ReStale Kit

> **What it does:** ReStale Kit coordinates cache invalidation over Server-Sent Events (SSE). When database mutations occur on the server, you broadcast invalidation signals (`group.local.broadcast(...)` or `group.cluster.broadcast(...)`), and connected browser clients automatically refetch their active queries. No websockets, no polling, zero bloat.

---

## Prerequisites

- **Node.js**: `>=18.0.0` (uses native Web Streams `ReadableStream`, Fetch API, and crypto).
- **TypeScript**: `>=5.0.0`

---

## Installation

```sh
npm install restale-kit
```

Install peer dependencies for your client/server framework:

```sh
# Using React + TanStack Query
npm install @tanstack/react-query react

# Using React + SWR
npm install swr react

# Using Distributed Pub/Sub (pick one)
npm install ioredis    # Redis
npm install ably       # Ably
npm install pusher     # Pusher
```

---

## 5-Minute Setup: Express + TanStack Query

### 1. Server Setup

<!-- snippet:start server-express -->
```ts
import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'

interface UserMeta {
  userId: string
}

const app = express()
app.use(express.json())

const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
})

// SSE Endpoint: clients connect via EventSource / SSEClient
app.get('/api/sse', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : 'anonymous'
  await group.handle(req, res, {
    meta: { userId },
  })
})

// Context sync endpoint: client reports active query keys
app.post('/api/sse', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : 'anonymous'
  await group.handle(req, res, {
    meta: { userId },
  })
})

// Mutation endpoint: invalidates cache after database write
app.post('/api/todos', async (req, res) => {
  const body = req.body
  const userId = typeof body?.userId === 'string' ? body.userId : 'anonymous'
  const text = typeof body?.text === 'string' ? body.text : ''
  // ... save todo to database ...

  // Targeted invalidation for this user's queries
  group.local.broadcast(
    { key: ['todos', { userId }] },
    (meta) => meta?.userId === userId,
  )

  res.status(201).json({ success: true, text })
})

app.listen(3000, () => console.log('Server running on port 3000'))
```
<!-- snippet:end -->

### 2. Client Setup (React + TanStack Query)

<!-- snippet:start client-tanstack -->
```tsx
import { useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { RestaleProvider, useRestale } from 'restale-kit/react'
import { tanstackQueryAdapter } from 'restale-kit/tanstack-query'

export function App() {
  const [queryClient] = useState(() => new QueryClient())
  const [onInvalidate] = useState(() => tanstackQueryAdapter(queryClient))

  return (
    <QueryClientProvider client={queryClient}>
      <RestaleProvider url="/api/sse?userId=user_123" onInvalidate={onInvalidate}>
        <TodoList />
      </RestaleProvider>
    </QueryClientProvider>
  )
}

interface TodoItem {
  id: string
  text: string
}

function TodoList() {
  const { isConnected, connection } = useRestale()

  const { data: todos } = useQuery<TodoItem[]>({
    queryKey: ['todos', { userId: 'user_123' }],
    queryFn: async () => {
      const res = await fetch('/api/todos?userId=user_123')
      const items: unknown = await res.json()
      return Array.isArray(items)
        ? items.filter((item): item is TodoItem => Boolean(item && typeof item === 'object' && 'id' in item && 'text' in item))
        : []
    },
  })

  return (
    <div>
      <p>Connection: {isConnected ? 'Live' : connection.status}</p>
      <ul>
        {todos?.map((todo) => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
    </div>
  )
}
```
<!-- snippet:end -->

---

## Verifying with Doctest

```ts doctest:getting_started_verification
import { SSEChannelGroup } from 'restale-kit/server'

const group = new SSEChannelGroup({
  secret: 'test-secret-key-32-chars-long-min',
})

expect(group.secret).toBe('test-secret-key-32-chars-long-min')
expect(typeof group.handle).toBe('function')
expect(typeof group.local.broadcast).toBe('function')
```

---

## Next Steps

- [Core Concepts](./concepts.md)
- [Security Model & Token Signing](./security-model.md)
- [Server Framework Recipes](../recipes/server-express.md)
- [Distributed Pub/Sub](../recipes/pubsub-redis.md)
