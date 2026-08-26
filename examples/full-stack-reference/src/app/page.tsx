'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRestale } from 'restale-kit/react'
import type { Todo } from '@/lib/todos'

export default function HomePage() {
  const [text, setText] = useState('')
  const userId = 'user_1'
  const queryClient = useQueryClient()
  const { isConnected, connection } = useRestale()

  const { data: todos = [], isLoading } = useQuery<Todo[]>({
    queryKey: ['todos', { userId }],
    queryFn: async () => {
      const res = await fetch(`/api/todos?userId=${encodeURIComponent(userId)}`)
      if (!res.ok) throw new Error('Failed to fetch todos')
      return res.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async (todoText: string) => {
      const res = await fetch(`/api/todos?userId=${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: todoText }),
      })
      if (!res.ok) throw new Error('Failed to create todo')
      return res.json()
    },
    onSuccess: () => {
      setText('')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const res = await fetch(`/api/todos/${id}?userId=${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      })
      if (!res.ok) throw new Error('Failed to toggle todo')
      return res.json()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/todos/${id}?userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete todo')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    createMutation.mutate(text.trim())
  }

  return (
    <main className="max-w-2xl mx-auto py-12 px-4">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">ReStale Kit Full-Stack Reference</h1>
          <p className="text-sm text-slate-400">Next.js App Router + TanStack Query + Redis SSE Invalidation</p>
        </div>
        <div className="flex items-center space-x-2">
          <span
            className={`w-3 h-3 rounded-full ${
              isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-rose-500'
            }`}
          />
          <span className="text-xs font-mono uppercase tracking-wider text-slate-300">
            {connection.status}
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a new todo item..."
          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={createMutation.isPending || !text.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Add Todo
        </button>
      </form>

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden backdrop-blur">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Loading todos...</div>
        ) : todos.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No todos yet. Add one above!</div>
        ) : (
          <ul className="divide-y divide-slate-800/80">
            {todos.map((todo) => (
              <li key={todo.id} className="p-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
                <label className="flex items-center space-x-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={(e) => toggleMutation.mutate({ id: todo.id, completed: e.target.checked })}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-blue-500"
                  />
                  <span className={`text-sm ${todo.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                    {todo.text}
                  </span>
                </label>
                <button
                  onClick={() => deleteMutation.mutate(todo.id)}
                  className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1 rounded hover:bg-rose-950/30 transition-colors"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
