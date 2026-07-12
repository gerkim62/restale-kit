Based on the contract, here's the complete usage from both ends.

---

## Server Side

### Express
```ts
import express from 'express'
import { attachSSE } from 'restale-kit/node'

const app = express()
const channels = new Set()

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  channels.add(channel)
  channel.stream // already piped by attachSSE

  req.on('close', () => channels.delete(channel))
})

// Somewhere else in your app — after a DB write, a webhook, etc.
function notifyTodosChanged() {
  for (const channel of channels) {
    channel.invalidate({ key: ['todos'] })
  }
}

function notifyEverything() {
  for (const channel of channels) {
    channel.invalidate({ key: [] }) // [] = invalidate all
  }
}
```

### Hono (or Bun / Deno / edge)
```ts
import { Hono } from 'hono'
import { toSSEResponse } from 'restale-kit/fetch'

const app = new Hono()
const channels = new Set()

app.get('/sse', (c) => {
  const { response, channel } = toSSEResponse(c.req.raw)
  channels.add(channel)

  // cleanup when client disconnects
  c.req.raw.signal.addEventListener('abort', () => channels.delete(channel))

  return response // hand it back to Hono — this is the inverted flow
})

// Same invalidation call from anywhere in your app
function notifyUserChanged(userId: number) {
  for (const channel of channels) {
    channel.invalidate({ key: ['user', { userId }], exact: true })
  }
}
```

### Fastify (special case)
```ts
import Fastify from 'fastify'
import { attachSSE } from 'restale-kit/node'

const app = Fastify()

app.get('/sse', (request, reply) => {
  reply.hijack() // required — stops Fastify sending its own response
  const channel = attachSSE(request.raw, reply.raw)
  // same channels Set pattern as Express
})
```

### Sending multiple invalidations at once
```ts
channel.invalidate([
  { key: ['todos'] },
  { key: ['todos-count'] },
])
```

---

## Client Side (React + TanStack Query)

```tsx
import { useSSEInvalidator } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'

function App() {
  const queryClient = useQueryClient()

  const { connection, reconnect, close } = useSSEInvalidator('/sse', {
    onInvalidate: tanstackAdapter(queryClient),
  })

  return <div>SSE: {connection.status}</div>
}
```

That's the minimal wiring. Everything else — fetching, caching, UI — is your existing TanStack Query code, untouched.

---

## Connection Status (optional UI)

```tsx
function SSEStatus() {
  const queryClient = useQueryClient()
  const { connection, reconnect } = useSSEInvalidator('/sse', {
    onInvalidate: tanstackAdapter(queryClient),
    autoReconnect: true,
    reconnect: { baseDelayMs: 1000, maxDelayMs: 30000, jitter: true },
  })

  if (connection.status === 'error') {
    return <button onClick={reconnect}>Reconnect</button>
  }

  return <span>{connection.status}</span> // 'connecting' | 'open' | 'closed'
}
```

---

## Disabling (e.g. unauthenticated users)

```tsx
const { user } = useAuth()

useSSEInvalidator('/sse', {
  disabled: !user,  // won't connect until user is present
  onInvalidate: tanstackAdapter(queryClient),
})
```

---

## Using `client-core` directly (no React)

If you're on Vue, Svelte, or vanilla JS — you skip `restale-kit/react` and drive the client yourself:

```ts
import { SSEInvalidatorClient } from 'restale-kit/client-core'

const client = new SSEInvalidatorClient('/sse', { autoReconnect: true })

client.addEventListener('invalidate', (e) => {
  const signal = e.detail  // InvalidateSignal | InvalidateSignal[]
  // call your own cache library here
})

client.addEventListener('statuschange', (e) => {
  console.log(e.detail.status) // 'connecting' | 'open' | 'closed' | 'error'
})

await client.connect()

// later
client.close()
```

---

## Mental Model Summary

```
Your server logic
  └─ channel.invalidate(signal)         ← you call this after a mutation

      │  SSE wire (text/event-stream)

restale-kit/react
  └─ useSSEInvalidator                  ← connects, reconnects, unmounts cleanly
      └─ onInvalidate(signal)           ← fires on every received event

restale-kit/tanstack-query
  └─ tanstackAdapter(queryClient)       ← translates signal → queryClient.invalidateQueries()

TanStack Query
  └─ refetches the stale queries        ← your UI updates automatically
```

The user's job is only two things: call `channel.invalidate()` on the server after a mutation, and pass `tanstackAdapter(queryClient)` to `onInvalidate` on the client. Everything in between is the library.