# Redis Pub/Sub Recipe

Distributed cache invalidation across pods using `redisPubSubAdapter` and `ioredis`.

---

## Implementation

<!-- snippet:start pubsub-redis -->
```ts
import { Redis } from 'ioredis'
import { SSEChannelGroup } from 'restale-kit/server'
import { redisPubSubAdapter } from 'restale-kit/redis'

interface UserMeta {
  userId: string
}

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')

const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
  pubsub: redisPubSubAdapter(redis),
})

// Distributed broadcast across all server instances
export async function broadcastToAllPods(topic: string, queryKey: string[]) {
  await group.cluster.broadcast(topic, {
    key: queryKey,
  })
}

// Cluster-wide session revocation
export async function revokeUserAcrossCluster(userId: string) {
  await group.cluster.revokeWhere({ userId })
}
```
<!-- snippet:end -->
