# restale-kit — pub/sub adapter contract

## Problem

`SSEChannelGroup` holds channels in an in-process `Map`. On multi-instance deployments
(serverless especially), the instance that registers a channel and the instance that
later calls `broadcast()`/`broadcastToAll()` are often different processes with no
shared memory. A channel object itself can never move between processes — the live
socket only exists on the instance that opened it. What *can* cross instances is the
small JSON signal. A pub/sub broker relays that signal to every instance, and each
instance independently delivers it to any locally-held matching channels.

Pub/sub (not a queue) is required specifically because delivery must reach **every**
current subscriber, not just one — queue/competing-consumer semantics would silently
drop signals for some connected clients.

## Core agnosticism principle

`core` knows nothing about any specific broker (Redis, Ably, Pusher, Postgres, ...).
It defines a minimal `PubSubAdapter` interface. Adapters live in separate subpath
exports and translate a broker's native API to that interface. `core` compiles and
functions with zero adapters installed — it just falls back to local-only delivery.

## `PubSubAdapter` interface

```ts
type PubSubMessage<TSignal extends InvalidateSignal = InvalidateSignal> =
  | { kind: 'signal'; data: TSignal | TSignal[] }
  | { kind: 'control'; data: JSONValue }

export interface PubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal> {
  publish(topic: string, message: PubSubMessage<TSignal>): Promise<void>

  subscribe(
    topic: string,
    onMessage: (message: PubSubMessage<TSignal>) => void
  ): Promise<() => void | Promise<void>>

  onError?(handler: (error: unknown) => void): void
}
```

Payloads are wrapped in a discriminated `PubSubMessage` union so that a single pair of
`publish`/`subscribe` methods handles both invalidation signals and control messages (e.g.,
connection revocation) with full type safety via the `kind` discriminant.

- Topics are plain strings. Payloads are `TSignal` — same JSON constraint as the wire
  protocol everywhere else.
- Adapters own their own broker-level reconnect/resilience. `SSEChannelGroup` does not
  retry broker failures; `onError` is observability only.
- Adapters accept an **already-constructed, already-authenticated client** (e.g. an
  `ioredis` instance), never a URL or API key. Credential handling (env vars, secrets
  managers, key rotation) is left entirely to the broker's own SDK and the user's own
  setup code — `core` never reads `process.env` or handles auth, keeping it runtime-
  agnostic and avoiding a second, redundant credential-handling surface.
- **Batching is preserved end-to-end, never silently unwrapped.** If a caller passes
  `publish(topic, [a, b])`, a conforming adapter's `onMessage` on the receiving side
  must fire once with `[a, b]`, not twice with `a` and `b` separately. Adapters that
  wrap brokers without native batch support must serialize the array as a single
  message envelope rather than issuing multiple broker-level publishes.
- **Self-echo suppression is the adapter's responsibility, not core's.** Some brokers
  (e.g. Redis pub/sub) deliver a publisher's own message back to itself if it's also
  subscribed to that topic; others (e.g. Ably) suppress this natively. A conforming
  adapter must ensure `onMessage` is never invoked for a message that this same
  adapter instance published — typically via an internal origin tag on the outgoing
  broker-level payload, checked and stripped before invoking the handler. `TSignal`
  itself is never mutated or wrapped to carry this tag; it stays adapter-internal.
- **Errors from `pubsub.publish()` propagate to the caller of `group.publish()`.**
  `SSEChannelGroup` does not swallow them and does not retry. `onError` is a
  separate, best-effort observability channel for adapter-internal failures (e.g. a
  dropped broker connection) that aren't tied to a specific `publish()` call and
  therefore have no caller to reject.

## Encryption & Security Contract

Every PubSub adapter factory function (Redis, Ably, Pusher) requires explicit `PubSubEncryptionOptions`:

```ts
export type PubSubEncryptionOptions =
  | { encrypt: false }
  | { encryptionKey: string; encrypt?: true }
```

- **Explicit configuration mandatory:** Either `{ encrypt: false }` or `{ encryptionKey: string }` must be provided. Passing neither throws an error at initialization time.
- **Key requirements:** `encryptionKey` must be a strictly encoded hex (>=64 chars) or base64 (>=44 chars) key that decodes to at least 32 bytes (AES-256).
- **AES-256-GCM cipher:** When encryption is active, payloads published over the broker are encrypted using AES-256-GCM with a fresh 12-byte CSPRNG IV per message.
- **Topic AAD Binding:** The pub/sub topic string is bound as Additional Authenticated Data (AAD) during encryption. A ciphertext published on topic A cannot be replayed onto topic B.
- **Wire envelope format:** Encrypted envelopes wrap payloads into string format `iv:authTag:ciphertext` within the origin envelope structure:
  ```ts
  interface PubSubEnvelope<T extends InvalidateSignal = InvalidateSignal> {
    origin: string
    payload: PubSubMessage<T> | string // encrypted string if key configured
  }
  ```
- **Decryption failures:** Failed decryption attempts emit a `PubSubDecryptionError` via `onError` (throttled to avoid log flooding) and ignore the malformed message without throwing or breaking the subscription loop.


## `SSEChannelGroup` pub/sub integration

- Constructor accepts optional `pubsub?: PubSubAdapter<TSignal>`.
- `register(channel, meta, { topics? })` — `topics` is an optional list of topic strings this connection subscribes to, used for pub/sub routing. Predicate-based `broadcast()` is unaffected for local-only use.
- **Per-channel topic membership is tracked alongside a topic-level manager.** The internal `channels` map records each channel's topics set. `deregister(channel)` uses this to clean up topic subscriptions when a channel leaves.
- Internally, each topic is managed by a `TopicManager` that maintains a `Set` of channels and a single broker subscription. The first channel registered on a topic creates the broker subscription; the last channel leaving a topic triggers unsubscription. Multiple local channels on the same topic never create duplicate broker subscriptions.
  - **Race on concurrent register/unsubscribe** is handled via a sequential `pendingOp` promise chain — the async subscribe/unsubscribe operations are serialized so that a `register()` arriving while an `unsubscribe()` is still in flight correctly restores the subscription.
- `publish(topic, signal)`:
  1. Delivers synchronously to any locally-held channels registered on that topic.
  2. If a `pubsub` adapter is configured, also calls `pubsub.publish(topic, { kind: 'signal', data: signal })` — even if there are no local subscribers on the topic, because remote instances may hold matching channels.
- `publish()` to a topic with no local subscribers and no `pubsub` configured is a no-op, not an error.

## Adapter packages (subpath exports, each importing only its own broker's client lib)

```text
restale-kit/redis    # wraps a user-supplied ioredis (or compatible) client
restale-kit/ably     # wraps a user-supplied Ably client
restale-kit/pusher   # wraps a user-supplied Pusher client
```

`core` never imports any of these. Users install and pass in exactly one.

## Usage shape

```ts
import { SSEChannelGroup } from 'restale-kit/server'
import { redisPubSubAdapter } from 'restale-kit/redis'

const group = new SSEChannelGroup<Signal, Meta>({
  pubsub: redisPubSubAdapter(redisClient), // omit entirely = single-instance mode
})

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  group.register(channel, { userId }, { topics: [`user:${userId}`] })
  // No manual cleanup needed — channel auto-deregisters from the group on disconnect
})

// From any instance, with or without a live connection of its own:
await group.publish(`user:${userId}`, { key: ['todos'] })
```

## Non-goals

- Pub/sub messaging itself does not persist history; event replay across client reconnects is provided at the SSE layer via `EventStore` / `eventBufferCapacity`.
- No delivery guarantees beyond "at most once, per currently-subscribed instance."
- No built-in adapter for queue-style brokers (SQS, plain Kafka consumer groups)
  without an instance-unique ephemeral subscription — out of scope until a concrete
  need arises.
