import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'

interface UserMeta {
  userId: string
}

const app = express()
app.use(express.json())

const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
})

// SSE Endpoint: clients connect via EventSource / SSEClient
app.get('/api/sse', async (req, res) => {
  const userId = (req.query.userId as string) || 'anonymous'
  await group.handle(req, res, {
    meta: { userId },
  })
})

// Context sync endpoint: client reports active query keys
app.post('/api/sse', async (req, res) => {
  const userId = (req.query.userId as string) || 'anonymous'
  await group.handle(req, res, {
    meta: { userId },
  })
})

// Mutation endpoint: invalidates cache after database write
app.post('/api/todos', async (req, res) => {
  const { userId, text } = req.body as { userId: string; text: string }
  // ... save todo to database ...

  // Targeted invalidation for this user's queries
  group.local.broadcast(
    { key: ['todos', { userId }] },
    (meta) => meta?.userId === userId,
  )

  res.status(201).json({ success: true, text })
})

app.listen(3000, () => console.log('Server running on port 3000'))
