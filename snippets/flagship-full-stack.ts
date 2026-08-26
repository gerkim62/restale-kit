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

// App Router Route Handlers (app/api/sse/route.ts)
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const userId = url.searchParams.get('userId') || 'anonymous'
  return group.handle(request, {
    meta: { userId },
  })
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const userId = url.searchParams.get('userId') || 'anonymous'
  return group.handle(request, {
    meta: { userId },
  })
}

export async function broadcastTodoMutation(userId: string) {
  await group.cluster.broadcast(`todos:${userId}`, {
    key: ['todos', { userId }],
  })
}
