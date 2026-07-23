import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { SSEChannelGroup } from 'restale-kit/server'
import type { InvalidateSignal } from 'restale-kit'
import { createTodoApi } from '@restale-kit-example/shared'

const group = new SSEChannelGroup<InvalidateSignal, { userId: string }>({
  channelDefaults: { target: ['swr', 'tanstack-query'] },
})
const todos = createTodoApi((userId) => {
  group.broadcast({ key: ['todos', { userId }], action: 'invalidate' }, (meta) => meta.userId === userId)
})

async function readJson<T>(req: IncomingMessage): Promise<T> {
  let body = ''
  for await (const chunk of req) body += chunk
  return JSON.parse(body) as T
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost:3003')
    const userId = url.searchParams.get('userId') as string

    if (req.method === 'GET' && url.pathname === '/sse') {
      group.attachChannel(req, res, { meta: { userId } })
      return
    }
    if (req.method === 'GET' && url.pathname === '/todos') return sendJson(res, 200, todos.getTodos(userId))
    if (req.method === 'POST' && url.pathname === '/todos') {
      const { text } = await readJson<{ text: string }>(req)
      return sendJson(res, 201, todos.create(userId, text))
    }

    const match = url.pathname.match(/^\/todos\/([^/]+)$/)
    if (match && req.method === 'PATCH') {
      const todo = todos.update(userId, match[1], await readJson<{ text?: string; completed?: boolean }>(req))
      return todo ? sendJson(res, 200, todo) : sendJson(res, 404, { error: 'Todo not found' })
    }
    if (match && req.method === 'DELETE') {
      if (!todos.delete(userId, match[1])) return sendJson(res, 404, { error: 'Todo not found' })
      res.writeHead(204).end()
      return
    }
    sendJson(res, 404, { error: 'Not found' })
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Bad request' })
  }
}).listen(3003, () => console.log('Node server started on http://localhost:3003'))
