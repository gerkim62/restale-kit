import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { parse } from 'node:url'
import { createServer as createViteServer, loadEnv } from 'vite'

const port = Number(process.env.PORT ?? 5173)
const root = fileURLToPath(new URL('..', import.meta.url))
Object.assign(process.env, loadEnv(process.env.NODE_ENV ?? 'development', root, ''))

// Import after loading .env/.env.local: api/_lib.js reads REDIS_URL at module load.
const [{ default: sse }, { default: todos }, { default: todo }] = await Promise.all([
  import('../api/sse.js'),
  import('../api/todos/index.js'),
  import('../api/todos/[id].js'),
])

const vite = await createViteServer({
  root,
  server: { middlewareMode: true },
})

function addVercelResponseHelpers(res) {
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (value) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(value))
  }
}

async function parseBody(req) {
  if (!['POST', 'PATCH'].includes(req.method ?? '')) return undefined
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString()
  return text ? JSON.parse(text) : undefined
}

const server = http.createServer(async (req, res) => {
  const url = parse(req.url ?? '', true)
  const pathname = url.pathname ?? ''
  const match = pathname.match(/^\/api\/todos\/([^/]+)$/)
  const handler = pathname === '/api/sse' ? sse : pathname === '/api/todos' ? todos : match ? todo : undefined

  if (!handler) return vite.middlewares(req, res)
  try {
    req.query = { ...url.query, ...(match ? { id: decodeURIComponent(match[1]) } : {}) }
    req.body = await parseBody(req)
    addVercelResponseHelpers(res)
    await handler(req, res)
  } catch (error) {
    console.error(error)
    if (!res.headersSent) res.statusCode = 500
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'Internal server error' }))
  }
})

server.listen(port, () => console.log(`Vercel Redis example running at http://localhost:${port}`))
