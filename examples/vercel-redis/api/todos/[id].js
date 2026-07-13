import { getTodos, saveTodos } from '../_lib.js'

export default async function handler(req, res) {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : null
  const id = typeof req.query.id === 'string' ? req.query.id : null
  if (!userId || !id) return res.status(400).json({ error: 'userId and id are required' })

  const todos = await getTodos(userId)
  const index = todos.findIndex((todo) => todo.id === id)
  if (index === -1) return res.status(404).json({ error: 'Todo not found' })

  if (req.method === 'DELETE') {
    todos.splice(index, 1)
    await saveTodos(userId, todos)
    return res.status(204).end()
  }
  if (req.method !== 'PATCH') return res.status(405).end()

  const todo = todos[index]
  if (typeof req.body?.text === 'string' && req.body.text.trim()) todo.text = req.body.text.trim()
  if (typeof req.body?.completed === 'boolean') todo.completed = req.body.completed
  await saveTodos(userId, todos)
  return res.status(200).json(todo)
}
