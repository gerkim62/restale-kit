# Hono Server Recipe

Using `SSEChannelGroup` with Hono across Node.js, Bun, Deno, and Cloudflare Workers.

---

## Implementation

<!-- snippet:start server-hono -->
```ts
import { Hono } from 'hono'
import { SSEChannelGroup } from 'restale-kit/server'

interface UserMeta {
  userId: string
}

const app = new Hono()

const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
})

// Hono route handler: pass c.req.raw (standard Request)
app.get('/api/sse', async (c) => {
  const userId = c.req.query('userId') || 'anonymous'
  return group.handle(c.req.raw, {
    meta: { userId },
  })
})

app.post('/api/sse', async (c) => {
  const userId = c.req.query('userId') || 'anonymous'
  return group.handle(c.req.raw, {
    meta: { userId },
  })
})

app.post('/api/todos', async (c) => {
  const { userId, text } = await c.req.json<{ userId: string; text: string }>()
  // ... perform database mutation ...

  group.local.broadcast(
    { key: ['todos', { userId }] },
    (meta) => meta?.userId === userId,
  )

  return c.json({ success: true, text }, 201)
})

export default app
```
<!-- snippet:end -->
