# Pub/Sub Guide

## Why pub/sub?

When you run **multiple server instances** (horizontal scaling, serverless, edge), each instance holds its own in-memory `SSEChannelGroup`. A client's SSE connection is tied to whichever instance accepted it — but a mutation might happen on a _different_ instance.

Without pub/sub: instance 2 mutates the DB, calls `group.publish(...)`, but has no local channels → no client receives the signal.

With pub/sub: instance 2 publishes to a broker. The broker delivers to instance 1 (which holds the client's SSE connection). Instance 1 delivers the signal locally.

```text
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

## Encryption

Since message payloads are sent to third-party providers (Ably, Pusher, hosted Redis), they should be encrypted to prevent the provider from being able to read mutation keys and metadata in plain text.

All pub/sub adapters require configuring encryption options: you must either pass `{ encrypt: false }` to disable encryption, or pass a valid, non-empty `{ encryptionKey: string }` (optionally with `{ encrypt: true }`) to enable AES-256-GCM symmetric encryption.

> [!IMPORTANT]
> **Security Recommendation**: Generate an encryption key of 32+ bytes of entropy via a CSPRNG (e.g., base64 or hex encoded via `openssl rand -base64 32` or `openssl rand -hex 32`), not a human-chosen passphrase.
>
> **No Mixed-Mode Support**: You cannot mix encrypted and unencrypted publishers/subscribers in the same cluster. Mismatched messages are dropped. This constraint is critical to prevent an attacker with access to the pub/sub broker from injecting plain unencrypted payloads to bypass decryption and tamper with client invalidation states.
>
> **Key Rotation & Rollout**: There is no multi-key support or key-rotation mechanism. If you rotate the key, decryption of any in-flight or previously-published messages encrypted under the old key will fail. Decryption failures are caught safely (logged as warnings, dropping the message, and continuing processing). A coordinated/drained deploy is recommended for any key configuration updates.


---

## Setup pattern

```ts
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/express'
import { redisPubSubAdapter } from 'restale-kit/redis'
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

const group = new SSEChannelGroup({
  pubsub: redisPubSubAdapter(redis, {
    encryptionKey: process.env.PUBSUB_ENCRYPTION_KEY!,
  }),
})

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  const userId = req.user.id
  const sessionId = req.session.id

  // Register with metadata and topics this connection cares about
  group.register(channel, { userId, sessionId }, {
    topics: [`user:${userId}`, 'global'],
  })
})

// From any instance — no need to know which instance holds the client
async function onTodoMutation(userId: string) {
  await group.publish(`user:${userId}`, { key: ['todos'] })
}

async function onGlobalChange() {
  await group.publish('global', { key: [] })
}

// Revoke one connection cluster-wide. userId/sessionId are obtained from
// authenticated server state, not from the client request body.
async function logoutUserConnection(userId: string, sessionId: string, connectionId: string) {
  await group.revokeByConnectionId(connectionId, { userId, sessionId })
}
```

`connectionId` is an opaque client correlation value, not an authorization credential. Always combine it with trusted metadata such as `userId` or a server-authenticated `sessionId` when revoking from an HTTP handler.

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
  pubsub: redisPubSubAdapter(redis, {
    encryptionKey: process.env.PUBSUB_ENCRYPTION_KEY!,
  }),
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
})

const group = new SSEChannelGroup({
  pubsub: ablyPubSubAdapter(ably, {
    encryptionKey: process.env.PUBSUB_ENCRYPTION_KEY!,
  }),
})
```

Self-echo suppression is handled automatically via an internal envelope tag — you don't need to configure anything special on the Ably client.

If you prefer to use Ably's native echo suppression instead, pass `useNativeEchoSuppression: true` **and** configure `echoMessages: false` on your Ably client:

```ts
const ably = new Ably.Realtime({
  key: process.env.ABLY_API_KEY,
  echoMessages: false, // required when useNativeEchoSuppression: true
})

const group = new SSEChannelGroup({
  pubsub: ablyPubSubAdapter(ably, {
    useNativeEchoSuppression: true,
    encryptionKey: process.env.PUBSUB_ENCRYPTION_KEY!,
  }),
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

const pubsub = pusherPubSubAdapter(pusher, {
  encryptionKey: process.env.PUBSUB_ENCRYPTION_KEY!,
})

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
import type { PubSubAdapter, PubSubEncryptionOptions } from 'restale-kit/pubsub'
import type { PubSubMessage, InvalidateSignal } from 'restale-kit'

function myCustomAdapter(options: PubSubEncryptionOptions): PubSubAdapter {
  return {
    async publish(topic, message) {
      // Send PubSubMessage envelope to broker on topic.
      // message is a discriminated union:
      // - Signals: { kind: 'signal', data: TSignal | TSignal[], id?: string }
      //   Batched signals preserve their array structure: { kind: 'signal', data: [signalA, signalB], id?: string }
      //   When an eventStore is configured, id carries the sequence event ID for Last-Event-ID replay across instances.
      // - Control: { kind: 'control', data: JSONValue }
    },

    async subscribe(topic, onMessage) {
      // Subscribe to topic; call onMessage(message) when a PubSubMessage arrives.
      // Ensure batched signals remain preserved as { kind: 'signal', data: [signalA, signalB] } upon delivery.
      // Return an unsubscribe function.
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
- **Encryption options:** Custom adapters must require explicit `PubSubEncryptionOptions` (either `{ encrypt: false }` or `{ encryptionKey: string }`) and encrypt message payloads when encryption is configured (e.g. using `wrapEnvelope`/`unwrapEnvelope` with topic AAD binding).
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
- **Event history replay:** Pass a shared `eventStore` (or `eventBufferCapacity`) to both `SSEChannelGroup` and your transport helper (`attachSSE` / `toSSEResponse`) to enable `Last-Event-ID` event replay for reconnecting clients. Without an event store passed to the transport helper, clients that were disconnected when a signal fired do not receive missed events upon reconnect.
- Invalidation signals without replay configured are cheap to re-emit on subsequent mutations.
