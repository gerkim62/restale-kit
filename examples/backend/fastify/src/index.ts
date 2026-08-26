import Fastify from 'fastify'
import { SSEChannelGroup } from 'restale-kit/server'
import { createTodoApi, UserIdSchema } from '@restale-kit-example/shared'
import type { ClientMeta } from '@restale-kit-example/shared'

const app = Fastify()
const group = new SSEChannelGroup<ClientMeta>({
  secret: 'dev-secret-key-for-fastify-example',
  scopeBy: ['userId'],
})
const todos = createTodoApi((userId) => {
  group.local.broadcast({ key: ['todos', { userId }] }, (meta) => meta?.userId === userId)
})

app.get<{ Querystring: { userId?: string } }>('/sse', async (request, reply) => {
  const queryUserId = request.query.userId
  const parsed = UserIdSchema.safeParse(queryUserId)
  if (!parsed.success) {
    return reply.code(401).send({ error: 'Unauthorized: invalid or missing session identity' })
  }
  const authenticatedUserId = parsed.data
  await group.handle(request, reply, {
    meta: { userId: authenticatedUserId },
  })
})

app.get<{ Querystring: { userId?: string } }>('/todos', (request) => {
  const uid = request.query.userId || 'ada'
  return todos.getTodos(uid)
})

app.post<{ Querystring: { userId?: string }; Body: { text: string } }>('/todos', (request, reply) => {
  const uid = request.query.userId || 'ada'
  return reply.code(201).send(todos.create(uid, request.body.text))
})

app.patch<{ Querystring: { userId?: string }; Params: { id: string }; Body: { text?: string; completed?: boolean } }>('/todos/:id', (request, reply) => {
  const uid = request.query.userId || 'ada'
  const { id } = request.params
  const todo = todos.update(uid, id, request.body)
  return todo ?? reply.code(404).send({ error: 'Todo not found' })
})

app.delete<{ Querystring: { userId?: string }; Params: { id: string } }>('/todos/:id', (request, reply) => {
  const uid = request.query.userId || 'ada'
  const { id } = request.params
  return todos.delete(uid, id) ? reply.code(204).send() : reply.code(404).send({ error: 'Todo not found' })
})

await app.listen({ port: 3002 })
