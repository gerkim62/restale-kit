import { useState, type FormEvent } from 'react'
import useSWR, { mutate } from 'swr'
import { useReStale } from 'restale-kit/react'
import { swrAdapter } from 'restale-kit/swr'
import { type Todo } from '@restale-kit-example/shared'
import './App.css'

const userId = 'demo-user'
const todosKey = ['todos', { userId }]
const todosUrl = `/api/todos?userId=${userId}`

const loadTodos = async (): Promise<Todo[]> => {
  const response = await fetch(todosUrl)
  if (!response.ok) throw new Error('Could not load todos')
  return response.json()
}

export default function App() {
  const [draft, setDraft] = useState('')
  const { data: todos = [] } = useSWR(todosKey, loadTodos, { revalidateOnFocus: false })
  const { connection } = useReStale(`/api/sse?userId=${userId}`, {
    onInvalidate: swrAdapter(mutate),
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
      <header><h1>ReStale + SWR</h1><span>SSE: {connection.status}</span></header>
      <form onSubmit={addTodo}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What needs doing?" /><button disabled={!draft.trim()}>Add todo</button></form>
      <ul>{todos.map((todo) => <li key={todo.id}>{todo.text}</li>)}</ul>
    </main>
  )
}
