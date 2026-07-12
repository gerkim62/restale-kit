import { useState, type FormEvent } from 'react'
import useSWR, { mutate } from 'swr'
import { useReStale } from 'restale-kit/react'
import { swrAdapter } from 'restale-kit/swr'
import { DemoUsers, type DemoUser, type Todo } from '@restale-kit-example/shared'
import './App.css'

function TodoApp({ user, signOut }: { user: DemoUser; signOut: () => void }) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<Todo | null>(null)
  const todosUrl = `/api/todos?userId=${user.id}`
  const todosKey = ['todos', { userId: user.id }]
  const { data: todos = [] } = useSWR<Todo[]>(todosKey, async () => {
    const response = await fetch(todosUrl)
    if (!response.ok) throw new Error('Could not load todos')
    return response.json()
  }, { revalidateOnFocus: false })
  const { connection } = useReStale(`/api/sse?userId=${user.id}`, {
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
    await mutate(todosKey)
    setDraft('')
  }

  async function updateTodo(id: string, update: Partial<Pick<Todo, 'text' | 'completed'>>) {
    await fetch(`/api/todos/${id}?userId=${user.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update),
    })
    await mutate(todosKey)
  }

  async function deleteTodo(id: string) {
    await fetch(`/api/todos/${id}?userId=${user.id}`, { method: 'DELETE' })
    await mutate(todosKey)
  }

  return (
    <main>
      <header><div><h1>Todos</h1><p>{user.name}</p></div><span>SSE: {connection.status}</span><button onClick={signOut}>Sign out</button></header>
      <form onSubmit={addTodo}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What needs doing?" /><button disabled={!draft.trim()}>Add todo</button></form>
      <ul>{todos.map((todo) => <li key={todo.id}>
        <input aria-label={`Complete ${todo.text}`} type="checkbox" checked={todo.completed} onChange={() => updateTodo(todo.id, { completed: !todo.completed })} />
        {editing?.id === todo.id ? <form onSubmit={(event) => { event.preventDefault(); updateTodo(todo.id, { text: editing.text }); setEditing(null) }}><input autoFocus value={editing.text} onChange={(event) => setEditing({ ...editing, text: event.target.value })} /><button>Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></form> : <><span className={todo.completed ? 'done' : ''}>{todo.text}</span><button type="button" onClick={() => setEditing(todo)}>Edit</button><button type="button" onClick={() => deleteTodo(todo.id)}>Delete</button></>}
      </li>)}</ul>
    </main>
  )
}

export default function App() {
  const [user, setUser] = useState<DemoUser | null>(() => DemoUsers.find((item) => item.id === sessionStorage.getItem('todo-user')) ?? null)
  const signIn = (nextUser: DemoUser) => { sessionStorage.setItem('todo-user', nextUser.id); setUser(nextUser) }
  const signOut = () => { sessionStorage.removeItem('todo-user'); setUser(null) }

  return user ? <TodoApp user={user} signOut={signOut} /> : <main><h1>Choose a user</h1><p>Each user has an independent Todo list.</p><div className="users">{DemoUsers.map((item) => <button key={item.id} onClick={() => signIn(item)}>{item.name}</button>)}</div></main>
}
