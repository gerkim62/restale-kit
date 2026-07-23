import Fastify from 'fastify'
import { SSEChannelGroup } from 'restale-kit/server'
import { AppSignalSchema, createTodoApi, UserIdSchema } from '@restale-kit-example/shared'
import type { AppSignal, ClientMeta } from '@restale-kit-example/shared'

const app = Fastify()
const group = new SSEChannelGroup<AppSignal, ClientMeta>({
  channelDefaults: { target: ['swr', 'tanstack-query'] },
})
const todos = createTodoApi((userId) => {
  group.broadcast({ key: ['todos', { userId }], action: 'invalidate' }, (meta) => meta?.userId === userId)
})
const userId = (query: unknown) => (query as { userId: string }).userId

app.get('/sse', (request, reply) => {
  const parsed = UserIdSchema.safeParse((request.query as Record<string, unknown>)?.userId)
  if (!parsed.success) {
    return reply.code(401).send({ error: 'Unauthorized: invalid or missing session identity' })
  }
  const authenticatedUserId = parsed.data
  // Pass request/reply directly — attachChannel calls reply.hijack() automatically
  group.attachChannel(request, reply, {
    meta: { userId: authenticatedUserId },
  })
})

app.get('/todos', (request) => todos.getTodos(userId(request.query)))

app.post('/todos', (request, reply) => {
  const { text } = request.body as { text: string }
  return reply.code(201).send(todos.create(userId(request.query), text))
})

app.patch('/todos/:id', (request, reply) => {
  const { id } = request.params as { id: string }
  const todo = todos.update(userId(request.query), id, request.body as { text?: string; completed?: boolean })
  return todo ?? reply.code(404).send({ error: 'Todo not found' })
})

app.delete('/todos/:id', (request, reply) => {
  const { id } = request.params as { id: string }
  return todos.delete(userId(request.query), id) ? reply.code(204).send() : reply.code(404).send({ error: 'Todo not found' })
})

await app.listen({ port: 3002 })
