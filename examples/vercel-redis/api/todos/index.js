import { getTodos, saveTodos } from '../_lib.js'

export default async function handler(req, res) {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : null
  if (!userId) return res.status(400).json({ error: 'userId is required' })

  if (req.method === 'GET') return res.status(200).json(await getTodos(userId))
  if (req.method !== 'POST') return res.status(405).end()

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
  if (!text) return res.status(400).json({ error: 'text is required' })
  const todos = await getTodos(userId)
  const todo = { id: crypto.randomUUID(), text, completed: false }
  todos.push(todo)
  await saveTodos(userId, todos)
  return res.status(201).json(todo)
}
