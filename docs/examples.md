# Integration Examples

This document provides complete, runnable integration examples for common framework and architecture patterns.

---

## 1. Express + TanStack Query

### Server (`server.ts`)

```ts
import express from 'express'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const app = express()
app.use(express.json())

// Create channel group with TanStack Query target default
const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

// SSE endpoint handler
app.get('/api/sse', (req, res) => {
  group.attachNodeResponse(req, res)
})

// Mutation endpoint broadcasting query key invalidation
app.post('/api/todos', (req, res) => {
  const newTodo = { id: Date.now(), title: req.body.title }
  group.broadcastToAll({ queryKey: ['todos'] })
  res.status(201).json(newTodo)
})

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000')
})
```

### Client (`App.tsx`)

```tsx
import React, { useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { useReStale } from 'restale-kit/react'
import { useTanstackQueryAdapter } from 'restale-kit/tanstack-query'

const queryClient = new QueryClient()

function TodoList() {
  const qc = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(qc)
  const [text, setText] = useState('')

  // Bind SSE connection to component lifecycle
  const { isConnected } = useReStale('/api/sse', { onInvalidate })

  const { data: todos = [] } = useQuery({
    queryKey: ['todos'],
    queryFn: async () => {
      const res = await fetch('/api/todos')
      return res.json() as Promise<Array<{ id: number; title: string }>>
    },
  })

  const addTodo = async () => {
    if (!text) return
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: text }),
    })
    setText('')
  }

  return (
    <div>
      <div>SSE Connected: {String(isConnected)}</div>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={addTodo}>Add Todo</button>
      <ul>
        {todos.map((t) => (
          <li key={t.id}>{t.title}</li>
        ))}
      </ul>
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TodoList />
    </QueryClientProvider>
  )
}
```

---

## 2. Hono + SWR

### Server (`server.ts`)

```ts
import { Hono } from 'hono'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const app = new Hono()
const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.SWR },
})

app.get('/api/sse', (c) => {
  const { response } = group.createFetchResponse(c.req.raw)
  return response
})

app.post('/api/user-profile', async (c) => {
  group.broadcastToAll({ key: '/api/user-profile' })
  return c.json({ success: true })
})

export default app
```

### Client (`App.tsx`)

```tsx
import React from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { useReStale } from 'restale-kit/react'
import { useSwrAdapter } from 'restale-kit/swr'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function UserProfile() {
  const { mutate } = useSWRConfig()
  const onInvalidate = useSwrAdapter(mutate)

  useReStale('/api/sse', { onInvalidate })

  const { data, error } = useSWR('/api/user-profile', fetcher)

  if (error) return <div>Failed to load profile</div>
  if (!data) return <div>Loading...</div>

  return <div>Welcome, {data.name}</div>
}
```

---

## 3. Per-User Invalidation

### Server (`server.ts`)

```ts
import express from 'express'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

interface UserSessionMeta {
  userId: string
}

const app = express()
app.use(express.json())

const group = new SSEChannelGroup<InvalidateSignal, UserSessionMeta>({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

// Authentication middleware extracts user ID
app.get('/api/sse', (req, res) => {
  const userId = req.headers['x-user-id'] as string
  if (!userId) {
    res.status(401).send('Unauthorized')
    return
  }

  group.attachNodeResponse(req, res, {
    meta: { userId },
  })
})

// Targeted broadcast to a specific user
app.post('/api/notifications/mark-read', (req, res) => {
  const userId = req.headers['x-user-id'] as string

  group.broadcast(
    { queryKey: ['notifications', userId] },
    (meta) => meta.userId === userId
  )

  res.json({ success: true })
})

app.listen(3000)
```

---

## 4. Multi-Instance with Redis Pub/Sub

### Server (`server.ts`)

```ts
import express from 'express'
import Redis from 'ioredis'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'
import { redisPubSubAdapter } from 'restale-kit/redis'

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
  pubsub: redisPubSubAdapter(redis),
})

const app = express()
app.use(express.json())

app.get('/api/sse', (req, res) => {
  const userId = req.headers['x-user-id'] as string
  group.attachNodeResponse(req, res, {
    topics: [`user:${userId}`],
  })
})

// Publish signal across server cluster via Redis
app.post('/api/orders/update', async (req, res) => {
  const { targetUserId } = req.body

  await group.publish(`user:${targetUserId}`, {
    queryKey: ['orders', targetUserId],
  })

  res.json({ success: true })
})

app.listen(3000)
```

---

## 5. Vanilla JS Client (`SSEInvalidatorClient`)

```ts
import { SSEInvalidatorClient } from 'restale-kit/client'

const client = new SSEInvalidatorClient('/api/sse', {
  target: 'generic',
  autoReconnect: true,
  reconnect: {
    baseDelayMs: 1000,
    maxDelayMs: 15000,
  },
})

client.addEventListener('statuschange', (event: CustomEvent) => {
  console.log('[SSE] Status:', event.detail.status)
})

client.addEventListener('invalidate', (event: CustomEvent) => {
  console.log('[SSE] Invalidation signal received:', event.detail)
})

client.addEventListener('revoke', (event: CustomEvent) => {
  console.warn('[SSE] Connection revoked by server. Reason:', event.detail.reason)
})

void client.connect()
```

---

## 6. Custom Signal Types with TypeScript Generics

```ts
import { SSEChannelGroup } from 'restale-kit/server'
import type { BaseInvalidateSignal } from 'restale-kit'

interface CustomProductSignal extends BaseInvalidateSignal {
  target: 'generic'
  key: ['products', string]
  action: 'invalidate'
  productId: string
}

const group = new SSEChannelGroup<CustomProductSignal>({
  target: 'generic',
})

// Strictly type-checked to CustomProductSignal
group.broadcastToAll({
  target: 'generic',
  key: ['products', 'prod_99'],
  action: 'invalidate',
  productId: 'prod_99',
})
```
