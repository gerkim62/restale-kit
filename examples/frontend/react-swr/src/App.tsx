import { useEffect, useMemo, useState, type FormEvent } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import { useReStale } from 'restale-kit/react'
import { swrAdapter } from 'restale-kit/swr'
import { AppSignalSchema, type AppSignal, type Todo } from '@restale-kit-example/shared'
import './App.css'

type Server = 'express' | 'hono' | 'fastify' | 'node'

const servers: ReadonlyArray<{ value: Server; label: string }> = [
  { value: 'express', label: 'Express · Node adapter' },
  { value: 'hono', label: 'Hono · Fetch adapter' },
  { value: 'fastify', label: 'Fastify · Node adapter' },
  { value: 'node', label: 'Native Node · Node adapter' },
]

function isServer(value: string): value is Server {
  return servers.some((server) => server.value === value)
}

const fetcher = async (url: string): Promise<Todo[]> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load todos')
  return response.json()
}

function App() {
  const [userId, setUserId] = useState('demo-user')
  const [draft, setDraft] = useState('')
  const [server, setServer] = useState<Server>('express')
  const apiBase = `/api/${server}`
  const todosUrl = userId ? `${apiBase}/todos?userId=${encodeURIComponent(userId)}` : null
  const todosKey = useMemo(() => userId ? ['todos', { userId }] : null, [userId])
  const loadTodos = async (): Promise<Todo[]> => {
    if (todosUrl === null) return []
    return fetcher(todosUrl)
  }
  const { data: todos = [], error, isLoading, mutate } = useSWR<Todo[]>(todosKey, loadTodos, {
    revalidateOnFocus: false,
  })

  // The server is transport configuration rather than part of the shared
  // domain key, so changing it explicitly refreshes the canonical SWR key.
  useEffect(() => {
    if (todosKey) void mutate()
  }, [apiBase, mutate, todosKey])

  const { connection, reconnect } = useReStale<AppSignal>(
    userId ? `${apiBase}/sse?userId=${encodeURIComponent(userId)}` : '',
    {
      disabled: !userId,
      signalSchema: AppSignalSchema,
      onInvalidate: swrAdapter(globalMutate),
    }
  )

  async function addTodo(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !todosUrl) return
    const response = await fetch(todosUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!response.ok) return
    const todo: Todo = await response.json()
    setDraft('')
    await mutate([...todos, todo], false)
  }

  async function updateTodo(todo: Todo, completed: boolean) {
    const response = await fetch(`${apiBase}/todos/${todo.id}?userId=${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    })
    if (!response.ok) return
    const updated: Todo = await response.json()
    await mutate(todos.map((item) => item.id === updated.id ? updated : item), false)
  }

  async function deleteTodo(todo: Todo) {
    const response = await fetch(`${apiBase}/todos/${todo.id}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' })
    if (response.ok) await mutate(todos.filter((item) => item.id !== todo.id), false)
  }

  return (
    <main>
      <header>
        <div>
          <h1>ReStale + SWR</h1>
          <p>The same shared API contract, cached with SWR.</p>
        </div>
        <span className={`status ${connection.status}`}>SSE: {connection.status}</span>
      </header>

      <section className="controls">
        <label>User ID <input value={userId} onChange={(event) => setUserId(event.target.value)} /></label>
        <label>Backend
          <select value={server} onChange={(event) => {
            if (isServer(event.target.value)) setServer(event.target.value)
          }}>
            {servers.map((serverOption) => (
              <option key={serverOption.value} value={serverOption.value}>{serverOption.label}</option>
            ))}
          </select>
        </label>
        {connection.status === 'error' && <button onClick={() => void reconnect()}>Reconnect</button>}
      </section>

      <form onSubmit={addTodo} className="add-todo">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What needs doing?" />
        <button disabled={!draft.trim()}>Add todo</button>
      </form>

      {isLoading && <p>Loading todos…</p>}
      {error && <p className="error">{error.message}</p>}
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label><input type="checkbox" checked={todo.completed} onChange={(event) => void updateTodo(todo, event.target.checked)} /> {todo.text}</label>
            <button onClick={() => void deleteTodo(todo)}>Delete</button>
          </li>
        ))}
      </ul>
    </main>
  )
}

export default App
