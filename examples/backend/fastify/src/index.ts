import Fastify from 'fastify'
import { SSEChannelGroup } from 'restale-kit/server'
import type { InvalidateSignal } from 'restale-kit'
import { attachSSE } from 'restale-kit/fastify'
import { createTodoApi } from '@restale-kit-example/shared'

const app = Fastify()
const group = new SSEChannelGroup<InvalidateSignal, { userId: string }>()
const todos = createTodoApi((userId) => {
  group.broadcast({ key: ['todos', { userId }], action: 'invalidate' }, (meta) => meta.userId === userId)

})
const userId = (query: unknown) => (query as { userId: string }).userId

app.get('/sse', (request, reply) => {
  // Pass request/reply directly — attachSSE calls reply.hijack() automatically
  const channel = attachSSE(request, reply)
  group.register(channel, { userId: userId(request.query) })
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
