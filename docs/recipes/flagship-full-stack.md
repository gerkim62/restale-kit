# Flagship Full-Stack Reference Recipe

Full end-to-end integration: **Next.js App Router + TanStack Query + Redis Distributed Pub/Sub + Scoped Authentication**.

---

## Architecture Overview

1. **Server Transport**: Next.js Route Handlers (`app/api/sse/route.ts`) executing `group.handle(request)`.
2. **Client**: `@tanstack/react-query` wired through `<RestaleProvider onInvalidate={tanstackQueryAdapter(queryClient)}>`.
3. **Pub/Sub**: `redisPubSubAdapter(redis)` broadcasting across all server instances.
4. **Auth**: `scopeBy: ['userId']` HMAC signing.

---

## Server Route Handler

<!-- snippet:start flagship-full-stack -->
```ts
import { Redis } from 'ioredis'
import { SSEChannelGroup } from 'restale-kit/server'
import { redisPubSubAdapter } from 'restale-kit/redis'

interface UserMeta {
  userId: string
}

// Next.js Route Handler + Redis + Scoped Auth
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')

export const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
  pubsub: redisPubSubAdapter(redis),
})

// App Router Route Handler (GET and POST /api/sse)
export async function handleNextSse(request: Request, userId: string): Promise<Response> {
  return group.handle(request, {
    meta: { userId },
  })
}

export async function broadcastTodoMutation(userId: string) {
  await group.cluster.broadcast(`todos:${userId}`, {
    key: ['todos', { userId }],
  })
}
```
<!-- snippet:end -->

---

## Client Application Component

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

function TodoList() {
  const { isConnected, connection } = useRestale()

  const { data: todos } = useQuery({
    queryKey: ['todos', { userId: 'user_123' }],
    queryFn: async () => {
      const res = await fetch('/api/todos?userId=user_123')
      return (await res.json()) as Array<{ id: string; text: string }>
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
