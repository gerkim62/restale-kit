import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
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

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of req) body += chunk
  return JSON.parse(body)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost:3003')
    const userId = UserIdSchema.parse(url.searchParams.get('userId'))

    if (req.method === 'GET' && url.pathname === '/sse') {
      const channel = attachSSE(req, res, { signalSchema: AppSignalSchema })
      group.register(channel, { userId })
      req.once('close', () => group.deregister(channel))
      return
    }
    if (req.method === 'GET' && url.pathname === '/todos') return sendJson(res, 200, todos.getTodos(userId))
    if (req.method === 'POST' && url.pathname === '/todos') {
      const { text } = CreateTodoSchema.parse(await readJson(req))
      return sendJson(res, 201, todos.create(userId, text))
    }

    const match = url.pathname.match(/^\/todos\/([^/]+)$/)
    if (match && req.method === 'PATCH') {
      const todo = todos.update(userId, match[1], UpdateTodoSchema.parse(await readJson(req)))
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
