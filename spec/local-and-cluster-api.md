# Unified Local & Cluster API Architecture

## Overview & Philosophy

ReStale provides two distinct execution scopes:

1. **`group.local.*` (Single Process / In-Memory):** Operates strictly on connection streams held in the current process memory. Requires zero Redis, zero message brokers, and zero topic definitions.
2. **`group.cluster.*` (Multi-Instance / Distributed Pub/Sub):** Operates across the entire cluster using serializable topic strings and control messages over a `PubSubAdapter` (Redis, Ably, Pusher), while automatically delivering to local connections on the current node as well. If called without a configured `pubsub` adapter, throws an immediate configuration error.

By organizing the API under **`group.local`** and **`group.cluster`**, the boundary between in-memory operations and distributed network operations is 100% explicit, eliminating multi-instance bugs and configuration confusion.

---

## Universal HTTP Route Handler: `group.handle()`

ReStale provides a single, universal HTTP handler **`group.handle()`** that works seamlessly across **all frameworks** (Express, Fastify, Next.js, Hono, Bun, Deno) and handles **both `GET` (stream connection) and `POST` (context sync) in one line**.

```ts
// Express / Node.js HTTP (Requires express.json() middleware):
app.all('/sse', (req, res) => group.handle(req, res, { meta: { userId: req.user.id } }))

// Next.js App Router / Fetch API:
export const GET = (req) => group.handle(req, { meta: { userId: getUserId(req) } })
export const POST = (req) => group.handle(req, { meta: { userId: getUserId(req) } })

// Hono / Bun / Cloudflare Workers:
app.all('/sse', (c) => group.handle(c.req.raw, { meta: { userId: c.get('userId') } }))
```

---

## The Unified API Matrix

| Functional Category | `group.local.*` *(Current Node Memory)* | `group.cluster.*` *(Entire Cluster via Broker)* |
| :--- | :--- | :--- |
| **1. Cache Invalidation** *(Client Refetches)* | **`.broadcast(signal, filter)`**<br/>`filter`: `{ key: val }` \| `(meta) => boolean` \| `true` | **`.broadcast(topic, signal)`**<br/>`topic`: string *(e.g. `'user:42'`, `'global'`)* |
| **2. Direct Inline Cache Push** *(No Refetch, Resolved)* | **`.pushInlineData(payload, filter)`**<br/>`filter`: `{ key: val }` \| `(meta) => boolean` \| `true` | **`.pushInlineData(topic, payload)`**<br/>`topic`: string *(routes to distributed resolvers)* |
| **3. Criteria Revocation** *(Logout / Ban)* | **`.revokeWhere(filter)`**<br/>`filter`: `{ key: val }` \| `(meta) => boolean` \| `true` | **`.revokeWhere(filter)`**<br/>`filter`: `{ key: val }` JSON object \| `true` |
| **4. ID Revocation** *(Single Connection)* | **`.revokeByConnectionId(connectionId, scope)`**<br/>`scope`: strictly typed `Pick<TMeta, TScopeKeys>` | **`.revokeByConnectionId(connectionId, scope)`**<br/>`scope`: strictly typed `Pick<TMeta, TScopeKeys>` |
| **5. State & Inspection** | **`.size`** *(Property: active local connections)* | *(Handled automatically across cluster)* |

---

## The Universal Filter Types

### `LocalFilter<TMeta>` (For `group.local.*`)
Every `group.local` operation accepts a universal `LocalFilter<TMeta>`. 

```ts
export type LocalFilter<TMeta> =
  | true                                    // 1. Explicitly target ALL local connections
  | ((meta: TMeta | undefined) => boolean)  // 2. Dynamic JavaScript predicate function
  | Partial<TMeta>                          // 3. Declarative JSON criteria (deep subset matching)
```

### `ClusterFilter<TMeta>` (For `group.cluster.revokeWhere`)
Every `group.cluster.revokeWhere` operation accepts a serializable `ClusterFilter<TMeta>`.

```ts
export type ClusterFilter<TMeta> =
  | true                                    // 1. Explicitly target ALL cluster connections (Caution: kicks all users!)
  | Partial<TMeta>                          // 2. Declarative JSON criteria (deep subset matching across cluster)
```

### Safety Rule: Explicit `true` Required for Match-All
To prevent accidental data leaks or mass invalidations caused by an unexpected `undefined` variable (e.g. unauthenticated session), **omitting the filter is strictly disallowed across all applications**. 

You must explicitly pass:
* A criteria object: `{ userId: '42' }`
* A predicate function (local only): `(meta) => meta?.role === 'admin'`
* Or literal **`true`** to intentionally target all connections.

Passing `undefined` or `false` throws a `TypeError` and is rejected at compile-time by TypeScript.

> [!CAUTION]
> **Cluster Revoke-All Warning:** Calling `group.cluster.revokeWhere(true)` will disconnect and revoke **every single connected client across every server instance in the entire cluster**. Use only for emergency system maintenance or global deployments.

### Deep Subset Matching
When passing object criteria `{ key: val }`, ReStale performs **deep recursive subset matching**:
* Primitives match exactly (`actual === expected`).
* Nested objects match if all keys in `expected` match in `actual`.
* Arrays match by **element containment / subset** (every element in `expected` must exist in `actual`, e.g. `{ roles: ['admin'] }` matches `{ roles: ['user', 'admin'] }`).

---

## 1. Cache Invalidation (`broadcast`)

Signals client cache libraries (TanStack Query, SWR, RTK Query) to mark queries stale and refetch them in the background.

### Local (In-Memory)

```ts
// Invalidate for specific user (shorthand criteria object):
group.local.broadcast({ key: ['todos'] }, { userId: '42' })

// Invalidate for specific roles (dynamic predicate function):
group.local.broadcast({ key: ['admin-stats'] }, (meta) => meta?.roles.includes('admin'))

// Invalidate for ALL local connections (explicit `true` required):
group.local.broadcast({ key: [] }, true)
```

### Cluster (Distributed / Multi-Instance)

```ts
// Broadcast invalidation to all cluster subscribers on a topic:
await group.cluster.broadcast(`user:${todo.userId}`, { key: ['todos'] })

// Broadcast global invalidation across the entire cluster:
await group.cluster.broadcast('global', { key: [] })
```

---

## 2. Direct Inline Cache Push (`pushInlineData`)

Invokes the configured `inlineDataResolver` to compute tailored cache payloads (based on each client's `clientContext`, such as page or filters) and writes them directly into the client's cache (`setQueryData` / `mutate`) **without triggering a network refetch**.

* **Guard:** Throws an Error immediately if `inlineDataResolver` was not configured on `SSEChannelGroup`.

### Local (In-Memory — Zero Topics Needed!)

In a single-instance app, you do not need to register or manage topics. You pass the mutation `payload` and an explicit filter:

```ts
// Push inline data to all connections belonging to team 'engineering':
await group.local.pushInlineData(
  { changedTodoId: '10' },
  { teamId: 'engineering' }
)

// Push inline data to ALL local connections:
await group.local.pushInlineData({ announcementId: '5' }, true)
```

### Cluster (Distributed / Multi-Instance)

In a multi-instance cluster, you pass the `topic` and the mutation `payload`. ReStale dispatches a lightweight message across the broker; every node resolves its own local connections in parallel:

```ts
// Dispatches to all instances holding connections subscribed to 'team:engineering':
await group.cluster.pushInlineData('team:engineering', { changedTodoId: '10' })
```

---

## 3. Connection Revocation (`revokeWhere` & `revokeByConnectionId`)

Closes SSE connection streams intentionally (e.g. on user logout, account ban, or session expiration), sending a terminal `event: revoke` frame that suppresses automatic client reconnection.

### Cryptographically Verified Revocation by ID
Calling `revokeByConnectionId(connectionId, scope)` verifies the token's HMAC signature deterministically against the provided `scope` (typed as `Pick<TMeta, TScopeKeys>`). If the signature fails or the token was tampered with, it returns `{ closed: false }` without propagating invalid operations across the cluster.

### Local (In-Memory)

```ts
// Kick user 42 on this instance (criteria):
group.local.revokeWhere({ userId: '42' })

// Kick expired sessions on this instance (predicate):
group.local.revokeWhere((meta) => meta?.expiresAt < Date.now())

// Kick ALL connections on this instance (e.g. server shutdown):
group.local.revokeWhere(true)

// Close one specific connection on this instance (cryptographically verified with typed scope):
group.local.revokeByConnectionId(connectionId, { userId: '42' })
```

### Cluster (Distributed / Multi-Instance)

```ts
// Kick user 42 across all pods in the entire cluster:
await group.cluster.revokeWhere({ userId: '42' })

// Kick ALL connections across the entire cluster (emergency maintenance):
await group.cluster.revokeWhere(true)

// Close one specific connection across whichever pod holds it (cryptographically verified):
await group.cluster.revokeByConnectionId(connectionId, { userId: '42' })
```

---

## Complete End-to-End Examples

### Example A: Single-Instance Monolith (Express)

```ts
import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'
import { z } from 'zod'

interface UserMeta {
  userId: string
  teamId: string
}

interface ClientCtx {
  page: number
}

interface TodoPayload {
  teamId: string
}

const group = new SSEChannelGroup<UserMeta, ClientCtx>({
  secret: process.env.RESTALE_SECRET!,
  scopeBy: ['userId', 'teamId'],
  clientContextSchema: z.object({ page: z.number() }),
  inlineDataResolver: async (connections, payload: TodoPayload) => {
    const todos = await db.todos.findMany({ where: { teamId: payload.teamId } })
    return new Map(connections.map((conn) => {
      const page = conn.clientContext?.page ?? 0
      return [
        conn.connectionId,
        {
          action: 'inlineData',
          signal: { key: ['todos', { page }] },
          inlineData: todos.slice(page * 20, (page + 1) * 20),
        }
      ]
    }))
  }
})

const app = express()
app.use(express.json()) // Required for POST /sse body parsing

// Universal Route Handler (Handles GET stream, POST context, and OPTIONS preflight automatically)
app.all('/sse', (req, res) => {
  return group.handle(req, res, {
    meta: { userId: req.user.id, teamId: req.user.teamId },
  })
})

// Mutation 1: Invalidation (Refetch)
app.post('/api/todos', async (req, res) => {
  const todo = await db.todos.create({ data: req.body })
  group.local.broadcast({ key: ['todos'] }, { teamId: todo.teamId })
  res.status(201).json(todo)
})

// Mutation 2: Inline Data Push (Direct Cache Write, No Refetch)
app.patch('/api/todos/:id', async (req, res) => {
  const todo = await db.todos.update({ where: { id: req.params.id }, data: req.body })
  await group.local.pushInlineData({ teamId: todo.teamId }, { teamId: todo.teamId })
  res.json(todo)
})

// Logout Route: Revocation by connection ID or criteria
app.post('/api/logout', async (req, res) => {
  if (req.body.connectionId) {
    group.local.revokeByConnectionId(req.body.connectionId, { userId: req.user.id, teamId: req.user.teamId })
  } else {
    group.local.revokeWhere({ userId: req.user.id })
  }
  res.json({ ok: true })
})
```

---

### Example B: Distributed Multi-Instance (Next.js App Router + Redis)

```ts
// lib/restale.ts
import { SSEChannelGroup } from 'restale-kit/server'
import { redisPubSubAdapter } from 'restale-kit/redis'
import Redis from 'ioredis'
import { z } from 'zod'

interface UserMeta {
  userId: string
  teamId: string
}

interface ClientCtx {
  page: number
}

const redis = new Redis(process.env.REDIS_URL!)

export const group = new SSEChannelGroup<UserMeta, ClientCtx>({
  secret: process.env.RESTALE_SECRET!,
  scopeBy: ['userId', 'teamId'],
  pubsub: redisPubSubAdapter(redis),
  clientContextSchema: z.object({ page: z.number() }),
  inlineDataResolver: async (connections, payload: { teamId: string }) => {
    const todos = await db.todos.findMany({ where: { teamId: payload.teamId } })
    return new Map(connections.map((conn) => {
      const page = conn.clientContext?.page ?? 0
      return [
        conn.connectionId,
        {
          action: 'inlineData',
          signal: { key: ['todos', { page }] },
          inlineData: todos.slice(page * 20, (page + 1) * 20),
        }
      ]
    }))
  }
})

// app/api/sse/route.ts
import { group } from '@/lib/restale'
import { getSession } from '@/lib/auth'

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return new Response('Unauthorized', { status: 401 })

  return group.handle(req, {
    meta: { userId: session.userId, teamId: session.teamId },
    topics: [`team:${session.teamId}`, `user:${session.userId}`],
  })
}

export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return new Response('Unauthorized', { status: 401 })

  return group.handle(req, {
    meta: { userId: session.userId, teamId: session.teamId },
  })
}

// app/api/todos/route.ts (Mutation on ANY instance)
export async function POST(req: Request) {
  const data = await req.json()
  const todo = await db.todos.create({ data })

  // Invalidation across cluster:
  await group.cluster.broadcast(`team:${todo.teamId}`, { key: ['todos'] })

  return Response.json(todo, { status: 201 })
}
```

