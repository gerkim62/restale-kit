import { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { RestaleProvider, useRestale } from 'restale-kit/react'
import { swrAdapter } from 'restale-kit/swr'

export function App() {
  const { mutate } = useSWRConfig()
  const [onInvalidate] = useState(() => swrAdapter(mutate))

  return (
    <RestaleProvider url="/api/sse?userId=user_123" onInvalidate={onInvalidate}>
      <TodoList />
    </RestaleProvider>
  )
}

function TodoList() {
  const { isConnected } = useRestale()

  const { data: todos } = useSWR<Array<{ id: string; text: string }>>(
    ['todos', { userId: 'user_123' }],
    async () => {
      const res = await fetch('/api/todos?userId=user_123')
      return res.json()
    },
  )

  return (
    <div>
      <p>Status: {isConnected ? 'Connected' : 'Reconnecting...'}</p>
      <ul>
        {todos?.map((todo) => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
    </div>
  )
}
