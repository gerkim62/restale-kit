import type { FastifyPluginAsync } from 'fastify'
import { SSEChannelGroup } from 'restale-kit'
import { attachSSE } from 'restale-kit/node'
import {
  AppSignalSchema,
  CreateTodoSchema,
  createTodoApi,
  type AppSignal,
  type ClientMeta,
  UpdateTodoSchema,
  UserIdSchema,
} from '@restale-kit-example/shared'

const group = new SSEChannelGroup<AppSignal, ClientMeta>()
const todos = createTodoApi((userId) => {
  group.broadcast({ key: ['todos', { userId }], action: 'invalidate' }, (meta) => meta.userId === userId)
})

const api: FastifyPluginAsync = async (fastify) => {
  fastify.get('/sse', (request, reply) => {
    const userId = UserIdSchema.parse((request.query as { userId?: unknown }).userId)
    reply.hijack()
    const channel = attachSSE(request.raw, reply.raw, { signalSchema: AppSignalSchema })
    group.register(channel, { userId })
    request.raw.once('close', () => group.deregister(channel))
  })

  fastify.get('/todos', (request) => {
    const userId = UserIdSchema.parse((request.query as { userId?: unknown }).userId)
    return todos.getTodos(userId)
  })

  fastify.post('/todos', (request, reply) => {
    const userId = UserIdSchema.parse((request.query as { userId?: unknown }).userId)
    const { text } = CreateTodoSchema.parse(request.body)
    return reply.code(201).send(todos.create(userId, text))
  })

  fastify.patch('/todos/:id', (request, reply) => {
    const userId = UserIdSchema.parse((request.query as { userId?: unknown }).userId)
    const { id } = request.params as { id: string }
    const todo = todos.update(userId, id, UpdateTodoSchema.parse(request.body))
    return todo ? todo : reply.code(404).send({ error: 'Todo not found' })
  })

  fastify.delete('/todos/:id', (request, reply) => {
    const userId = UserIdSchema.parse((request.query as { userId?: unknown }).userId)
    const { id } = request.params as { id: string }
    return todos.delete(userId, id) ? reply.code(204).send() : reply.code(404).send({ error: 'Todo not found' })
  })
}

export default api
