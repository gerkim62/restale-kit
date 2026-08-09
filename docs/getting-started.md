# Getting Started

## 1. Prerequisites

- **Node.js**: `>=18.0.0`
- **Peer Dependencies**:
  - For TanStack Query (React): `@tanstack/react-query` (`^5.0.0`), `react` (`^18.0.0` or `^19.0.0`)
  - For SWR: `swr` (`^2.0.0`), `react` (`^18.0.0` or `^19.0.0`)

---

## 2. Install

Install `restale-kit` along with the peer dependencies required for your stack.

### TanStack Query (React)

```sh
npm install restale-kit @tanstack/react-query react react-dom
```

### SWR (React)

```sh
npm install restale-kit swr react react-dom
```

### Vanilla JS (No UI framework)

```sh
npm install restale-kit
```

---

## 3. 5-Minute Setup

The following example establishes an Express server that pushes invalidation signals whenever a todo item is created, and a React component that automatically refetches its queries upon receiving the signal.

### Server (`server.ts`)

```ts
import express from 'express'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const app = express()
app.use(express.json())

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

app.get('/api/sse', (req, res) => {
  group.attachNodeResponse(req, res)
})

app.post('/api/todos', (req, res) => {
  group.broadcastToAll({ queryKey: ['todos'] })
  res.status(201).json({ success: true })
})

app.listen(3000, () => {
  console.log('Server listening on http://localhost:3000')
})
```

### Client (`App.tsx`)

```tsx
import React from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { useReStale } from 'restale-kit/react'
import { useTanstackQueryAdapter } from 'restale-kit/tanstack-query'

const queryClient = new QueryClient()

function TodoList() {
  const qc = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(qc)

  useReStale('/api/sse', { onInvalidate })

  const { data: todos, isLoading } = useQuery({
    queryKey: ['todos'],
    queryFn: async () => {
      const res = await fetch('/api/todos')
      return res.json() as Promise<Array<{ id: number; title: string }>>
    },
  })

  if (isLoading) return <div>Loading...</div>

  return (
    <ul>
      {todos?.map((todo) => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
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

## 4. Verify It Works

1. Start the Express server (`npx tsx server.ts`) and mount the React application.
2. Open the browser DevTools **Network** tab and filter by **EventStream** or `sse`. Confirm an active GET request to `/api/sse?__restale_cid__=...&__restale_target__=tanstack-query` with HTTP status `200`.
3. Send a POST request to create a todo item:
   ```sh
   curl -X POST http://localhost:3000/api/todos -H "Content-Type: application/json" -d '{}'
   ```
4. Observe the Network tab: an SSE event `event: invalidate` with payload `{"target":"tanstack-query","queryKey":["todos"]}` arrives, and TanStack Query automatically issues a background `GET /api/todos` request to update the UI.

---

## 5. What Just Happened

When the React component mounts, `useReStale` initializes an SSE stream to `/api/sse`, sending a generated client correlation ID (`__restale_cid__`) and target identifier. The server registers the connection inside `SSEChannelGroup`. When `group.broadcastToAll({ queryKey: ['todos'] })` is called on the server, the signal travels over the open SSE connection, where `useTanstackQueryAdapter` intercepts it and invokes `queryClient.invalidateQueries({ queryKey: ['todos'] })`.

For a deeper dive into the architectural flow, see [Concepts](./concepts.md).

---

## 6. Next Steps

- **Integrating Fastify, Hono, Bun, Deno, or Next.js** → See [Server Guide](./server.md)
- **Using SWR or Vanilla JS** → See [Client Guide](./client.md)
- **Targeting specific users with metadata** → See [Server Guide → Per-User Invalidation](./server.md#per-user-invalidation)
- **Securing SSE streams with HTTP-only cookies** → See [Security Guide](./security.md)
- **Scaling across multiple server instances** → See [Pub/Sub Guide](./pubsub.md)
