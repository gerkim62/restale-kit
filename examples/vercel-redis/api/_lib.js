import Redis from 'ioredis'
import { SSEChannelGroup } from 'restale-kit/server'
import { redisPubSubAdapter } from 'restale-kit/redis'

const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error('REDIS_URL is required.')

// Module scope lets warm Vercel functions reuse connections and subscriptions.
const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
redis.on('error', (error) => console.error('[redis]', error))
const group = new SSEChannelGroup({
  channelDefaults: { target: ['swr', 'tanstack-query'] },
  pubsub: redisPubSubAdapter(redis, process.env.PUBSUB_ENCRYPTION_KEY !== undefined
    ? { encryptionKey: process.env.PUBSUB_ENCRYPTION_KEY }
    : { encrypt: false }
  )
})

const todosKey = (userId) => `restale:vercel-example:todos:${userId}`
export const topic = (userId) => `restale:vercel-example:todos:${userId}`

export async function getTodos(userId) {
  return JSON.parse((await redis.get(todosKey(userId))) ?? '[]')
}

export async function saveTodos(userId, todos) {
  await redis.set(todosKey(userId), JSON.stringify(todos))
  await group.publish(topic(userId), { key: ['todos', { userId }], exact: true })
}

export function openSse(req, res, userId) {
  group.attachChannel(req, res, { topics: [topic(userId)] })
}

