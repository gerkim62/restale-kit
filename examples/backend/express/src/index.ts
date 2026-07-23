import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'
import {
  AppSignalSchema,
  CreateTodoSchema,
  createTodoApi,
  type AppSignal,
  type ClientMeta,
  UpdateTodoSchema,
  UserIdSchema,
} from '@restale-kit-example/shared'

const app = express()
const group = new SSEChannelGroup<AppSignal, ClientMeta>({
  channelDefaults: { target: ['swr', 'tanstack-query'] },
})
const todos = createTodoApi((userId) => {
  group.broadcast({ key: ['todos', { userId }], action: 'invalidate' }, (meta) => meta.userId === userId)
})

app.use(express.json())

app.get('/sse', (req, res) => {
  const userId = UserIdSchema.parse(req.query.userId)
  group.attachChannel(req, res, {
    meta: { userId },
  })
})

app.get('/todos', (req, res) => res.json(todos.getTodos(UserIdSchema.parse(req.query.userId))))

app.post('/todos', (req, res) => {
  const userId = UserIdSchema.parse(req.query.userId)
  const { text } = CreateTodoSchema.parse(req.body)
  res.status(201).json(todos.create(userId, text))
})

app.patch('/todos/:id', (req, res) => {
  const todo = todos.update(UserIdSchema.parse(req.query.userId), req.params.id, UpdateTodoSchema.parse(req.body))
  res.status(todo ? 200 : 404).json(todo ?? { error: 'Todo not found' })
})

app.delete('/todos/:id', (req, res) => {
  const deleted = todos.delete(UserIdSchema.parse(req.query.userId), req.params.id)
  res.status(deleted ? 204 : 404).json(deleted ? undefined : { error: 'Todo not found' })
})

app.listen(3000, () => console.log('Express server started on http://localhost:3000'))
