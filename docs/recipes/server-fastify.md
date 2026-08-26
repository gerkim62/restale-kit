# Fastify Server Recipe

Integrating `SSEChannelGroup` with Fastify 5.x without socket hijacking.

---

## Implementation

<!-- snippet:start server-fastify -->
```ts
import Fastify from 'fastify'
import { SSEChannelGroup } from 'restale-kit/server'

interface UserMeta {
  userId: string
}

const app = Fastify()

const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
})

// Fastify integration: pass request and reply directly
app.get('/api/sse', async (request, reply) => {
  const userId = (request.query as { userId?: string })?.userId || 'anonymous'
  await group.handle(request, reply, {
    meta: { userId },
  })
})

app.post('/api/sse', async (request, reply) => {
  const userId = (request.query as { userId?: string })?.userId || 'anonymous'
  await group.handle(request, reply, {
    meta: { userId },
  })
})

app.post('/api/todos', async (request, reply) => {
  const { userId, text } = request.body as { userId: string; text: string }
  // ... perform database write ...

  group.local.broadcast(
    { key: ['todos', { userId }] },
    (meta) => meta?.userId === userId,
  )

  return reply.code(201).send({ success: true, text })
})

await app.listen({ port: 3000 })
```
<!-- snippet:end -->
