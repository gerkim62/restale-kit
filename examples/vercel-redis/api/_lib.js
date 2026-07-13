import Redis from 'ioredis'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/node'
import { redisPubSubAdapter } from 'restale-kit/redis'

const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error('REDIS_URL is required.')

// Module scope lets warm Vercel functions reuse connections and subscriptions.
const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
redis.on('error', (error) => console.error('[redis]', error))
const group = new SSEChannelGroup({ pubsub: redisPubSubAdapter(redis) })

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
  const channel = attachSSE(req, res)
  group.register(channel, undefined, { topics: [topic(userId)] })
  req.once('close', () => group.deregister(channel))
}
