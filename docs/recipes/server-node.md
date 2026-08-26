# Raw Node.js HTTP Server Recipe

Using `SSEChannelGroup` with native `node:http` `createServer`.

---

## Implementation

<!-- snippet:start server-node -->
```ts
import http from 'node:http'
import { SSEChannelGroup } from 'restale-kit/server'

interface UserMeta {
  userId: string
}

const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
})

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === '/api/sse') {
    const userId = url.searchParams.get('userId') || 'anonymous'
    await group.handle(req, res, {
      meta: { userId },
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/todos') {
    // ... parse body & write to DB ...
    const userId = url.searchParams.get('userId') || 'anonymous'

    group.local.broadcast(
      { key: ['todos', { userId }] },
      (meta) => meta?.userId === userId,
    )

    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    return
  }

  res.writeHead(404).end('Not Found')
})

server.listen(3000)
```
<!-- snippet:end -->
