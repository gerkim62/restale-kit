# Pub/Sub Guide

## Why pub/sub?

When you run **multiple server instances** (horizontal scaling, serverless, edge), each instance holds its own in-memory `SSEChannelGroup`. A client's SSE connection is tied to whichever instance accepted it — but a mutation might happen on a _different_ instance.

Without pub/sub: instance 2 mutates the DB, calls `group.publish(...)`, but has no local channels → no client receives the signal.

With pub/sub: instance 2 publishes to a broker. The broker delivers to instance 1 (which holds the client's SSE connection). Instance 1 delivers the signal locally.

```
Client ──SSE──► Instance 1 ──subscribe──► Broker ◄──publish── Instance 2 ──DB write
```

> **Single-instance apps don't need pub/sub.** Use `broadcastToAll` or `broadcast` directly.

---

## How it works

1. When a channel is registered with `topics`, the group subscribes to those topics on the broker (first registration on a topic creates one broker subscription).
2. Any instance calls `group.publish(topic, signal)`.
3. The broker delivers to all subscribed instances.
4. Each instance delivers the signal to locally-held channels registered on that topic.
5. When the last channel on a topic disconnects, the group unsubscribes from the broker.

---

## Setup pattern

```ts
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/express'
import { redisPubSubAdapter } from 'restale-kit/redis'
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

const group = new SSEChannelGroup({
  pubsub: redisPubSubAdapter(redis),
})

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  const userId = req.user.id

  // Register with topics this connection cares about
  group.register(channel, { userId }, {
    topics: [`user:${userId}`, 'global'],
  })

  req.on('close', () => group.deregister(channel))
})

// From any instance — no need to know which instance holds the client
async function onTodoMutation(userId: string) {
  await group.publish(`user:${userId}`, { key: ['todos'] })
}

async function onGlobalChange() {
  await group.publish('global', { key: [] })
}
```

---

## Redis adapter (`ioredis`)

```sh
npm install ioredis
```

```ts
import Redis from 'ioredis'
import { redisPubSubAdapter } from 'restale-kit/redis'

// Pass a single client — the adapter creates a duplicate internally for subscribe
const redis = new Redis(process.env.REDIS_URL)

const group = new SSEChannelGroup({
  pubsub: redisPubSubAdapter(redis),
})
```

> **Self-echo suppression:** Redis pub/sub delivers messages back to the publisher if it's also subscribed. The adapter handles this transparently — your `onMessage` handler will not be called for messages you published.

---

## Ably adapter

```sh
npm install ably
```

```ts
import * as Ably from 'ably'
import { ablyPubSubAdapter } from 'restale-kit/ably'

const ably = new Ably.Realtime({
  key: process.env.ABLY_API_KEY,
  echoMessages: false, // suppress self-echo at the Ably level
})

const group = new SSEChannelGroup({
  pubsub: ablyPubSubAdapter(ably),
})
```

---

## Pusher adapter

Pusher delivers messages to servers via **HTTP webhooks** rather than a persistent connection, so you need an extra webhook route.

```sh
npm install pusher
```

```ts
import Pusher from 'pusher'
import { pusherPubSubAdapter } from 'restale-kit/pusher'

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
})

const pubsub = pusherPubSubAdapter(pusher)

const group = new SSEChannelGroup({ pubsub })

// Required: receive Pusher's webhook messages
app.post('/pusher/webhook', express.raw({ type: '*/*' }), (req, res) => {
  // Pass the raw body string and headers to the adapter
  const body = req.body.toString()
  const headers = req.headers as Record<string, string>
  const processed = pubsub.handleWebhook(body, headers)
  res.status(processed ? 200 : 400).end()
})
```

---

## `PubSubAdapter` interface

If you need to write a custom adapter (e.g. for Postgres `LISTEN/NOTIFY`, NATS, etc.):

```ts
import type { PubSubAdapter } from 'restale-kit/pubsub'
import type { InvalidateSignal } from 'restale-kit'

function myCustomAdapter(): PubSubAdapter {
  return {
    async publish(topic, signal) {
      // Send signal to broker on topic
      // signal may be a single object or an array — serialize as-is (preserve batch)
    },

    async subscribe(topic, onMessage) {
      // Subscribe to topic; call onMessage(signal) when a message arrives
      // Return an unsubscribe function
      return async () => {
        // Unsubscribe from topic
      }
    },

    onError(handler) {
      // Optional: register a handler for adapter-internal errors
    },
  }
}
```

**Adapter contract rules:**
- **Preserve batches:** If `publish(topic, [a, b])` is called, `onMessage` on the receiving side must fire once with `[a, b]`, not twice separately.
- **Self-echo suppression:** `onMessage` must not be called for messages this adapter instance published (use an internal origin tag, not a mutation of the signal).
- **Broker reconnects:** Adapters own their own retry logic. `onError` is for observability only.
- **Pass a pre-constructed client:** Never accept credentials or URLs — take an already-authenticated broker client.

---

## Topic design patterns

Topics are plain strings — design them to match your invalidation granularity:

| Pattern | Topic example | Use case |
|---|---|---|
| Per-user | `user:42` | User-specific data |
| Per-tenant | `tenant:acme` | Multi-tenant SaaS |
| Global | `global` | Config, feature flags |
| Per-resource | `post:99:comments` | Fine-grained resource |

---

## Delivery guarantees

- **At most once per currently-subscribed instance.** If an instance loses its broker connection while a signal is published, that signal is dropped for that instance's clients.
- **No message replay.** Clients that were disconnected when a signal fired do not receive it on reconnect — same as SSE's native behavior.
- This is intentional: invalidation signals are cheap to re-emit on the next mutation.
