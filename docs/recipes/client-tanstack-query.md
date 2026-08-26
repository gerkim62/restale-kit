# TanStack Query Client Recipe

Integrating `RestaleProvider` with `@tanstack/react-query` and `tanstackQueryAdapter`.

---

## Implementation

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
