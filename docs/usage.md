Based on the contract, here's the complete usage from both ends.

---

## Server Side

### Express
```ts
import express from 'express'
import { SSEChannelGroup, InvalidateSignal } from 'restale-kit'
import { attachSSE } from 'restale-kit/node'

const app = express()

interface ClientMeta {
  userId: string
}

// Create a connection group managed by the library
const group = new SSEChannelGroup<InvalidateSignal, ClientMeta>()

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  
  // Register the channel with its metadata
  group.register(channel, { userId: req.user.id })

  req.on('close', () => {
    group.deregister(channel) // Remove on disconnect
  })
})

// After a DB write, a webhook, etc.

function notifyTodosChanged() {
  // Opt in to broadcast to everyone
  group.broadcastToAll({ key: ['todos'] })
}

function notifyUserTodosChanged(userId: string) {
  // Scoped broadcast (preferred) — filters channels by metadata
  group.broadcast(
    { key: ['todos', { userId }], exact: true },
    (meta) => meta.userId === userId
  )
}

function notifyEverything() {
  group.broadcastToAll({ key: [] }) // [] = invalidate all
}
```

### Hono (or Bun / Deno / edge)
```ts
import { Hono } from 'hono'
import { SSEChannelGroup, InvalidateSignal } from 'restale-kit'
import { toSSEResponse } from 'restale-kit/fetch'

const app = new Hono()

interface ClientMeta {
  userId: string
}

const group = new SSEChannelGroup<InvalidateSignal, ClientMeta>()

app.get('/sse', (c) => {
  const { response, channel } = toSSEResponse(c.req.raw)
  group.register(channel, { userId: c.get('userId') })

  // cleanup when client disconnects
  c.req.raw.signal.addEventListener('abort', () => {
    group.deregister(channel)
  })

  return response // hand it back to Hono — this is the inverted flow
})

// Same group.broadcast / group.broadcastToAll invalidation calls from anywhere in your app.
```

### Fastify (special case)
```ts
import Fastify from 'fastify'
import { attachSSE } from 'restale-kit/node'

const app = Fastify()

app.get('/sse', (request, reply) => {
  reply.hijack() // required — stops Fastify sending its own response
  const channel = attachSSE(request.raw, reply.raw)
  // same group.register + cleanup pattern as Express
})
```

### Sending multiple invalidations at once
```ts
channel.invalidate([
  { key: ['todos'] },
  { key: ['todos-count'] },
])
```

### Using the `refetch` and `remove` actions
```ts
// Force immediate refetch — don't just mark stale, refetch now
channel.invalidate({ key: ['dashboard'], action: 'refetch' })

// Purge from cache entirely — e.g. after a user deletes their account
channel.invalidate({ key: ['user', { userId: '123' }], exact: true, action: 'remove' })
```

---

## Client Side (React + TanStack Query)

```tsx
import { useReStale } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'

function App() {
  const queryClient = useQueryClient()

  const { connection, reconnect, close } = useReStale('/sse', {
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
  const { connection, reconnect } = useReStale('/sse', {
    onInvalidate: tanstackAdapter(queryClient),
    autoReconnect: true,
    reconnect: { baseDelayMs: 1000, maxDelayMs: 30000, jitter: true },
  })

  if (connection.status === 'error') {
    return <button onClick={reconnect}>Reconnect</button>
  }

  return <span>{connection.status}</span> // 'connecting' | 'open' | 'closed' | 'error'
}
```

---

## Disabling (e.g. unauthenticated users)

```tsx
const { user } = useAuth()

useReStale('/sse', {
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

## Zod & Standard Schema Integration (Optional)

For runtime validation of signals and full compile-time type safety, you can optionally pass standard schema validation objects (like Zod) on both the server and client. If omitted, the library uses plain `InvalidateSignal` and bypasses schema validation.

### Server Side with Zod

```ts
import express from 'express'
import { z } from 'zod'
import { SSEChannelGroup } from 'restale-kit'
import { attachSSE as attachNodeSSE } from 'restale-kit/node'

// 1. Define schema for valid application signals
const AppSignalSchema = z.object({
  key: z.union([
    z.tuple([z.literal('todos')]),
    z.tuple([z.literal('todos'), z.object({ userId: z.string() })]),
    z.tuple([z.literal('users'), z.string()]),
  ]),
  exact: z.boolean().optional(),
  action: z.enum(['invalidate', 'refetch', 'remove']).optional(),
})

type AppSignal = z.infer<typeof AppSignalSchema>

// 2. Define schema for connection metadata
const ClientMetaSchema = z.object({
  userId: z.string(),
})

type ClientMeta = z.infer<typeof ClientMetaSchema>

// 3. Type connection group and pass the metaSchema
const group = new SSEChannelGroup<AppSignal, ClientMeta>({
  metaSchema: ClientMetaSchema,
})

app.get('/sse', (req, res) => {
  // 4. Pass schema to attachSSE to type the returned channel
  const channel = attachNodeSSE(req, res, { signalSchema: AppSignalSchema })
  
  // Validation runs synchronously upon registration
  group.register(channel, { userId: req.user.id })

  req.on('close', () => {
    group.deregister(channel)
  })
})

// 5. Calling with incorrect structure will raise a TypeScript error and fail validation
function notifyUserTodos(userId: string) {
  // Scoped broadcast — filters channels by metadata
  group.broadcast(
    { key: ['todos', { userId }], exact: true }, // ✅ Valid
    (meta) => meta.userId === userId
  )
  
  // group.broadcast({ key: ['posts'] }, ...) // ❌ TypeScript compilation error
}
```

### Client Side with Zod

```tsx
import { z } from 'zod'
import { useReStale } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'

const AppSignalSchema = z.object({
  key: z.array(z.unknown()),
  exact: z.boolean().optional(),
  action: z.enum(['invalidate', 'refetch', 'remove']).optional(),
})

type AppSignal = z.infer<typeof AppSignalSchema>

function App() {
  const queryClient = useQueryClient()

  // Passes the generic and signalSchema option to enforce type safety
  const { connection } = useReStale<AppSignal>('/sse', {
    signalSchema: AppSignalSchema,
    onInvalidate: tanstackAdapter(queryClient), // Callback is typed to receive AppSignal | AppSignal[]
  })

  return <div>SSE: {connection.status}</div>
}
```

---

## Mental Model Summary

```
Your server logic
  └─ channel.invalidate(signal)         ← you call this after a mutation

      │  SSE wire (text/event-stream)

restale-kit/react
  └─ useReStale                         ← connects, reconnects, unmounts cleanly
      └─ onInvalidate(signal)           ← fires on every received event

restale-kit/tanstack-query
  └─ tanstackAdapter(queryClient)       ← translates signal → queryClient.invalidateQueries()

TanStack Query
  └─ refetches the stale queries        ← your UI updates automatically
```

The user's job is only two things: call `channel.invalidate()` on the server after a mutation, and pass `tanstackAdapter(queryClient)` to `onInvalidate` on the client. Everything in between is the library.