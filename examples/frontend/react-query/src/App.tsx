import { useState, type FormEvent } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useReStale } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'
import { AppSignalSchema, type AppSignal, type Todo } from '@restale-kit-example/shared'
import './App.css'

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
})
const userId = 'demo-user'
const todosUrl = `/api/todos?userId=${userId}`
const todosKey = ['todos', { userId }]

function TodoApp() {
  const [draft, setDraft] = useState('')
  const { data: todos = [] } = useQuery<Todo[]>({
    queryKey: todosKey,
    queryFn: async () => {
      const response = await fetch(todosUrl)
      if (!response.ok) throw new Error('Could not load todos')
      return response.json()
    },
  })
  const { connection } = useReStale<AppSignal>(`/api/sse?userId=${userId}`, {
    signalSchema: AppSignalSchema,
    onInvalidate: tanstackAdapter(client),
  })

  async function addTodo(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    await fetch(todosUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    setDraft('')
  }

  return (
    <main>
      <header><h1>ReStale + TanStack Query</h1><span>SSE: {connection.status}</span></header>
      <form onSubmit={addTodo}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What needs doing?" /><button disabled={!draft.trim()}>Add todo</button></form>
      <ul>{todos.map((todo) => <li key={todo.id}>{todo.text}</li>)}</ul>
    </main>
  )
}

export default function App() {
  return <QueryClientProvider client={client}><TodoApp /></QueryClientProvider>
}
