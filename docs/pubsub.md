# Pub/Sub & Horizontal Scaling Guide

## 1. When to Use Pub/Sub

Single-instance deployments maintain all client SSE connections in a single server process. Methods like `group.broadcastToAll` or `group.broadcast` operate in-memory on local channels.

When running multiple server instances (e.g., behind a load balancer, in serverless environments, or in Kubernetes clusters), client SSE connections are distributed across nodes. A database mutation handled by Instance A needs to invalidate cache states for clients connected to Instance B. Pub/sub brokers bridge nodes so signals published by any instance reach all connected clients cluster-wide.

```text
Client A ──SSE──► Node 1 ──subscribe──► Broker ◄──publish── Node 2 ◄── Mutation Request
```

---

## 2. Architecture

1. **Topic Subscription**: When a client attaches to an `SSEChannelGroup` with topics (`topics: ['user_123']`), the local group subscribes to those topics on the pub/sub broker.
2. **Publishing**: Any server instance calls `group.publish('user_123', signal)`.
3. **Broker Distribution**: The broker broadcasts the message envelope to all server nodes subscribed to `'user_123'`.
4. **Local Delivery**: Each node receives the message and writes the invalidation frame to its locally connected client streams.
5. **Auto-Unsubscribe**: When the last local channel assigned to a topic disconnects, the node unsubscribes from the broker topic automatically.

---

## 3. Adapter Setup

### Redis (`redisPubSubAdapter`)

```sh
npm install ioredis
```

```ts
import Redis from 'ioredis'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'
import { redisPubSubAdapter } from 'restale-kit/redis'

const redisClient = new Redis(process.env.REDIS_URL!)

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
  pubsub: redisPubSubAdapter(redisClient),
})
```

> **Gotcha:** `redisPubSubAdapter` automatically creates a duplicate Redis connection (`redisClient.duplicate()`) internally for blocking pub/sub subscriptions.

---

### Ably (`ablyPubSubAdapter`)

```sh
npm install ably
```

```ts
import Ably from 'ably'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'
import { ablyPubSubAdapter } from 'restale-kit/ably'

const ablyClient = new Ably.Realtime({ key: process.env.ABLY_API_KEY! })

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
  pubsub: ablyPubSubAdapter(ablyClient),
})
```

---

### Pusher (`pusherPubSubAdapter`)

```sh
npm install pusher
```

```ts
import Pusher from 'pusher'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'
import { pusherPubSubAdapter } from 'restale-kit/pusher'

const pusherClient = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
})

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
  pubsub: pusherPubSubAdapter(pusherClient),
})
```

---

## 4. Topics

Topics isolate signal delivery to specific channels or user groups:

```ts
app.get('/api/sse', (req, res) => {
  const userId = req.user.id
  group.attachNodeResponse(req, res, {
    topics: [`user:${userId}`, 'global_announcements'],
  })
})

// Publish signal to a specific user topic
await group.publish('user:user_123', { queryKey: ['orders'] })
```

---

## 5. `controlTopic`

The `controlTopic` option (defaulting to `'__restale_control__'`) specifies the internal pub/sub topic used for cluster-wide administrative operations such as remote connection revocation. Change this setting only if you need to isolate multiple `SSEChannelGroup` clusters running on the same pub/sub broker.

```ts
const group = new SSEChannelGroup({
  controlTopic: 'my_app_control_channel',
  pubsub: redisPubSubAdapter(redisClient),
})
```

---

## 6. Encryption

Pub/sub payload encryption protects query keys and metadata in transit across third-party brokers using AES-256-GCM symmetric encryption with topic-bound Additional Authenticated Data (AAD).

### Enabling Encryption

To enable encryption, pass an `encryptionKey` option to the pub/sub adapter:

```ts
const pubsub = redisPubSubAdapter(redisClient, {
  encryptionKey: process.env.PUB_SUB_ENCRYPTION_KEY,
})
```

### Key Generation Command

Generate a secure 32-byte (256-bit) base64 or hex key using OpenSSL:

```sh
openssl rand -base64 32
```

### Critical Security Constraints

- **No Mixed-Mode Support**: All nodes in a cluster must use identical encryption keys and options. Mixing encrypted and unencrypted publishers/subscribers results in dropped frames.
- **Key Rotation Limitation**: `restale-kit` does not support simultaneous multi-key decryption. Updating encryption keys requires a coordinated deployment across nodes.

---

## 7. Cluster-Wide Connection Revocation

Calling `group.revokeByConnectionId` or `group.revokeWhere` on a multi-instance group publishes a revocation control message to the `controlTopic`. Every server node receives the control signal and closes matching local channels immediately:

```ts
// Executed on Node A — revokes the connection across all cluster nodes
await group.revokeByConnectionId(connectionId, 'logout')
```
