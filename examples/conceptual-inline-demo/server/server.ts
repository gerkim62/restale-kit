import express from 'express'

const app = express()
app.use(express.json())

// ─── In-memory store ───────────────────────────────────────────────────────────

interface Todo {
  id: number
  text: string
  done: boolean
}

let nextId = 1
let todos: Todo[] = [
  { id: nextId++, text: 'Open this app in two tabs side-by-side', done: false },
  { id: nextId++, text: 'Add a todo in one tab — watch the other update', done: false },
  { id: nextId++, text: 'Click "Simulate External Mutation" and see both tabs update', done: false },
]

// ─── SSE channel management ────────────────────────────────────────────────────
// This is what restale-kit/node (attachSSE) will do internally.
// Inlined here to demonstrate the spec's wire protocol.

const channels = new Set<express.Response>()

/**
 * Broadcast an invalidation signal to all connected SSE clients.
 * Wire format per spec:
 *   event: invalidate\n
 *   data: <JSON>\n
 *   \n
 */
function broadcast(signal: { key: unknown[]; exact?: boolean; action?: string } | { key: unknown[]; exact?: boolean; action?: string }[]) {
  const frame = `event: invalidate\ndata: ${JSON.stringify(signal)}\n\n`
  const dead: express.Response[] = []

  for (const res of channels) {
    try {
      res.write(frame)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      // The express.Response socket write failure when a client is disconnected
      console.warn(
        "[WARN][broadcast] Failed to write frame to client channel, marking for cleanup",
        "\n  frame:", frame.slice(0, 500),
        "\n  error:", error.stack || error.message
      )
      dead.push(res)
    }
  }

  // Cleanup closed channels
  for (const res of dead) channels.delete(res)
}

// ─── SSE endpoint ──────────────────────────────────────────────────────────────
// Implements the spec's wire protocol: named event "invalidate", keepalive comments.

app.get('/sse', (req, res) => {
  // Headers per spec (what attachSSE sets)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  // Flush headers immediately
  res.flushHeaders()

  // Keepalive: `: keepalive\n\n` every 30s (spec default)
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n')
  }, 30_000)

  channels.add(res)
  console.log(`[SSE] Client connected (${channels.size} total)`)

  req.on('close', () => {
    clearInterval(keepalive)
    channels.delete(res)
    console.log(`[SSE] Client disconnected (${channels.size} total)`)
  })
})

// ─── REST API ──────────────────────────────────────────────────────────────────

app.get('/api/todos', (_req, res) => {
  // Simulate slight delay so you can see refetches happen
  setTimeout(() => res.json(todos), 100)
})

app.post('/api/todos', (req, res) => {
  const todo: Todo = { id: nextId++, text: req.body.text || 'Untitled', done: false }
  todos.push(todo)
  res.status(201).json(todo)

  // After mutation: broadcast invalidation signal (what your app code does)
  broadcast({ key: ['todos'] })
})

app.patch('/api/todos/:id', (req, res) => {
  const todo = todos.find(t => t.id === Number(req.params.id))
  if (!todo) return res.status(404).json({ error: 'Not found' })

  todo.done = !todo.done
  res.json(todo)

  broadcast({ key: ['todos'] })
})

app.delete('/api/todos/:id', (req, res) => {
  todos = todos.filter(t => t.id !== Number(req.params.id))
  res.status(204).end()

  broadcast({ key: ['todos'] })
})

// ─── Simulate external mutation ────────────────────────────────────────────────
// Demonstrates: a webhook / cron / another service modifies data and broadcasts.
// ALL connected clients see the update — not just the one that triggered it.

app.post('/api/simulate-external', (_req, res) => {
  const todo: Todo = { id: nextId++, text: `External event @ ${new Date().toLocaleTimeString()}`, done: false }
  todos.push(todo)
  res.json({ ok: true, added: todo })

  // Batch invalidation — multiple keys in one event
  broadcast([
    { key: ['todos'] },
    { key: ['todos-count'] },
  ])
})

// ─── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3001
app.listen(PORT, () => {
  console.log(`\n  restale-kit example server`)
  console.log(`  ─────────────────────────`)
  console.log(`  API:  http://localhost:${PORT}/api/todos`)
  console.log(`  SSE:  http://localhost:${PORT}/sse`)
  console.log()
})
