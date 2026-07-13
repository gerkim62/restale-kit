import { type FormEvent, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { useReStale } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'

type Todo = { id: string; text: string; completed: boolean }
const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })

function Todos() {
  const [userId, setUserId] = useState('ada')
  const [text, setText] = useState('')
  const queryClient = useQueryClient()
  const todosKey = useMemo(() => ['todos', { userId }] as const, [userId])
  const todosUrl = `/api/todos?userId=${encodeURIComponent(userId)}`
  const { data: todos = [] } = useQuery<Todo[]>({
    queryKey: todosKey,
    queryFn: async () => {
      const response = await fetch(todosUrl)
      if (!response.ok) throw new Error('Could not load todos')
      return response.json()
    },
  })
  const { connection } = useReStale(`/api/sse?userId=${encodeURIComponent(userId)}`, { onInvalidate: tanstackAdapter(queryClient) })

  async function addTodo(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    await fetch(todosUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: value }) })
    setText('')
  }
  async function toggle(todo: Todo) {
    await fetch(`/api/todos/${todo.id}?userId=${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: !todo.completed }) })
  }
  async function remove(todo: Todo) { await fetch(`/api/todos/${todo.id}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }) }

  return <main><h1>ReStale + Vercel + Redis</h1><p>Open two tabs with the same user. A Todo change invalidates the other tab through Redis Pub/Sub.</p><label>User <select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="ada">Ada</option><option value="grace">Grace</option></select></label><span className={`status ${connection.status}`}>SSE: {connection.status}</span><form onSubmit={addTodo}><input value={text} onChange={(event) => setText(event.target.value)} placeholder="What needs doing?" /><button>Add</button></form><ul>{todos.map((todo) => <li key={todo.id}><label><input type="checkbox" checked={todo.completed} onChange={() => toggle(todo)} /> <span className={todo.completed ? 'done' : ''}>{todo.text}</span></label><button onClick={() => remove(todo)}>Delete</button></li>)}</ul></main>
}

export default function App() { return <QueryClientProvider client={client}><Todos /></QueryClientProvider> }
