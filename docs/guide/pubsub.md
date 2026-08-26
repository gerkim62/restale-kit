# Distributed Pub/Sub Architecture

When scaling across multiple server instances, serverless functions, or Kubernetes pods, clients may be connected to different pods than the one executing a mutation.

ReStale Kit connects your pods via distributed pub/sub adapters (**Redis**, **Ably**, **Pusher**).

---

## 1. Cluster Operations

When a `pubsub` adapter is configured on `SSEChannelGroup`, you gain access to `group.cluster.*`:

- `group.cluster.broadcast(topic, signal)`: Broadcasts invalidations across all instances subscribed to `topic`.
- `group.cluster.pushInlineData(topic, payload)`: Delivers inline data cluster-wide.
- `group.cluster.revokeWhere(filter)`: Revokes matching client connections across every pod.
- `group.cluster.revokeByConnectionId(connectionId, scope?)`: Targets a specific connection ID anywhere in the cluster.

---

## 2. Redis Adapter Example

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

---

## 3. End-to-End Encryption

Pub/Sub messages across external brokers (Ably, Pusher) can be transparently AES-256-GCM encrypted by supplying `encryptionKey`:

```ts
const pubsub = ablyPubSubAdapter(ably, {
  encryptionKey: process.env.PUBSUB_ENCRYPTION_KEY!,
})
```

---

## Doctest

```ts doctest:pubsub_verification
import { SSEChannelGroup } from 'restale-kit/server'

const mockPubSub = {
  publish: async () => {},
  subscribe: async () => async () => {},
}

const group = new SSEChannelGroup({
  secret: 'pubsub-test-secret-32-chars-min',
  pubsub: mockPubSub,
})

expect(group.controlTopic).toBe('__restale_control__')
```
