import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { SSEChannelGroup } from 'restale-kit/server'
import { AppSignalSchema, createTodoApi, UserIdSchema } from '@restale-kit-example/shared'
import type { AppSignal, ClientMeta } from '@restale-kit-example/shared'

const group = new SSEChannelGroup<AppSignal, ClientMeta>({
  channelDefaults: { target: ['swr', 'tanstack-query'] },
})
const todos = createTodoApi((userId) => {
  group.broadcast({ key: ['todos', { userId }], action: 'invalidate' }, (meta) => meta.userId === userId)
})

function getAuthenticatedUserId(req: IncomingMessage): string | null {
  const authHeader = req.headers['x-user-id'] ?? req.headers['authorization']
  const parsed = UserIdSchema.safeParse(authHeader)
  return parsed.success ? parsed.data : null
}

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
    const queryUserId = url.searchParams.get('userId') as string

    if (req.method === 'GET' && url.pathname === '/sse') {
      const authUserId = getAuthenticatedUserId(req) ?? (UserIdSchema.safeParse(queryUserId).success ? queryUserId : 'ada')
      group.attachChannel(req, res, {
        signalSchema: AppSignalSchema,
        meta: { userId: authUserId },
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/todos') return sendJson(res, 200, todos.getTodos(queryUserId))
    if (req.method === 'POST' && url.pathname === '/todos') {
      const { text } = await readJson<{ text: string }>(req)
      return sendJson(res, 201, todos.create(queryUserId, text))
    }

    const match = url.pathname.match(/^\/todos\/([^/]+)$/)
    if (match && req.method === 'PATCH') {
      const todo = todos.update(queryUserId, match[1], await readJson<{ text?: string; completed?: boolean }>(req))
      return todo ? sendJson(res, 200, todo) : sendJson(res, 404, { error: 'Todo not found' })
    }
    if (match && req.method === 'DELETE') {
      if (!todos.delete(queryUserId, match[1])) return sendJson(res, 404, { error: 'Todo not found' })
      res.writeHead(204).end()
      return
    }
    sendJson(res, 404, { error: 'Not found' })
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Bad request' })
  }
}).listen(3003, () => console.log('Node server started on http://localhost:3003'))
