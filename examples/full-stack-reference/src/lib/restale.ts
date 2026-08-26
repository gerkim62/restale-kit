import Redis from 'ioredis'
import { SSEChannelGroup } from 'restale-kit/server'
import { redisPubSubAdapter } from 'restale-kit/redis'

export interface UserMeta {
  userId: string
  orgId?: string
}

declare global {
  // eslint-disable-next-line no-var
  var __restale_group__: SSEChannelGroup<UserMeta> | undefined
  // eslint-disable-next-line no-var
  var __redis_client__: Redis | undefined
}

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

function getRedisClient(): Redis {
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
    // In build/prerender environments without redis, use lazy client with error handler
    const client = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false })
    client.on('error', () => {})
    return client
  }
  if (!globalThis.__redis_client__) {
    globalThis.__redis_client__ = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false })
    globalThis.__redis_client__.on('error', () => {})
  }
  return globalThis.__redis_client__
}

export function getChannelGroup(): SSEChannelGroup<UserMeta> {
  if (process.env.NODE_ENV === 'production') {
    const redis = getRedisClient()
    return new SSEChannelGroup<UserMeta>({
      secret: process.env.RESTALE_SECRET || 'flagship-nextjs-secret-key-32-chars-min',
      scopeBy: ['userId'],
      pubsub: redisPubSubAdapter(redis),
    })
  }

  if (!globalThis.__restale_group__) {
    const redis = getRedisClient()
    globalThis.__restale_group__ = new SSEChannelGroup<UserMeta>({
      secret: process.env.RESTALE_SECRET || 'flagship-nextjs-secret-key-32-chars-min',
      scopeBy: ['userId'],
      pubsub: redisPubSubAdapter(redis),
    })
  }

  return globalThis.__restale_group__
}

export const group = getChannelGroup()
