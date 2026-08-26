# Next.js & Serverless Guide

ReStale Kit provides native support for Next.js App Router Route Handlers via Web standard Fetch API `Request` and `Response`.

---

## 1. HMR Singleton Pattern

In Next.js development mode, Hot Module Replacement (HMR) re-evaluates module files on save. To preserve active SSE connections across edits, store your `SSEChannelGroup` instance on `globalThis`:

<!-- snippet:start flagship-full-stack -->
```ts
import { Redis } from 'ioredis'
import { SSEChannelGroup } from 'restale-kit/server'
import { redisPubSubAdapter } from 'restale-kit/redis'

interface UserMeta {
  userId: string
}

// Next.js Route Handler + Redis + Scoped Auth
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')

export const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
  pubsub: redisPubSubAdapter(redis),
})

// App Router Route Handler (GET and POST /api/sse)
export async function handleNextSse(request: Request, userId: string): Promise<Response> {
  return group.handle(request, {
    meta: { userId },
  })
}

export async function broadcastTodoMutation(userId: string) {
  await group.cluster.broadcast(`todos:${userId}`, {
    key: ['todos', { userId }],
  })
}
```
<!-- snippet:end -->

---

## 2. Route Handlers (`app/api/sse/route.ts`)

In Next.js App Router:

```ts
import { type NextRequest } from 'next/server'
import { group } from '@/lib/restale'

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId') || 'anonymous'
  return group.handle(request, {
    meta: { userId },
  })
}

export async function POST(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId') || 'anonymous'
  return group.handle(request, {
    meta: { userId },
  })
}
```

---

## Doctest

```ts doctest:nextjs_verification
import { SSEChannelGroup } from 'restale-kit/server'

const group = new SSEChannelGroup({
  secret: 'nextjs-test-secret-32-chars-min',
})

const req = new Request('http://localhost/api/sse')
const res = await group.handle(req)
expect(res.headers.get('content-type')).toBe('text/event-stream')
```
