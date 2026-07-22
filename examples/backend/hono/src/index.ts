import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
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

const app = new Hono()
const group = new SSEChannelGroup<AppSignal, ClientMeta>({
  channelDefaults: { target: ['swr', 'tanstack-query'] },
})
const todos = createTodoApi((userId) => {
  group.broadcast({ key: ['todos', { userId }], action: 'invalidate' }, (meta) => meta.userId === userId)
})

app.use('*', cors())

app.get('/sse', (c) => {
  const userId = UserIdSchema.parse(c.req.query('userId'))
  const { response } = group.createChannel(c.req.raw, {
    signalSchema: AppSignalSchema,
    meta: { userId },
  })
  return response
})

app.get('/todos', (c) => c.json(todos.getTodos(UserIdSchema.parse(c.req.query('userId')))))

app.post('/todos', async (c) => {
  const userId = UserIdSchema.parse(c.req.query('userId'))
  const { text } = CreateTodoSchema.parse(await c.req.json())
  return c.json(todos.create(userId, text), 201)
})

app.patch('/todos/:id', async (c) => {
  const todo = todos.update(
    UserIdSchema.parse(c.req.query('userId')),
    c.req.param('id'),
    UpdateTodoSchema.parse(await c.req.json())
  )
  return todo ? c.json(todo) : c.json({ error: 'Todo not found' }, 404)
})

app.delete('/todos/:id', (c) => {
  const deleted = todos.delete(UserIdSchema.parse(c.req.query('userId')), c.req.param('id'))
  return deleted ? c.body(null, 204) : c.json({ error: 'Todo not found' }, 404)
})

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`Hono server started on http://localhost:${info.port}`)
})
