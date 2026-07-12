# restale-kit — pub/sub adapter contract (draft)

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
functions with zero adapters installed — it just falls back to local-only delivery
(today's `broadcast`/`broadcastToAll` behavior, unchanged).

## `PubSubAdapter` interface

```ts
export interface PubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal> {
  publish(topic: string, signal: TSignal | TSignal[]): Promise<void>

  subscribe(
    topic: string,
    onMessage: (signal: TSignal | TSignal[]) => void
  ): Promise<() => void> | (() => void) // returns/resolves an unsubscribe fn

  onError?(handler: (error: unknown) => void): void
}
```

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

## `SSEChannelGroup` changes

- Constructor accepts optional `pubsub?: PubSubAdapter<TSignal>`.
- `register(channel, meta, { topics? })` — `topics` is a new optional list of topic
  strings this connection cares about, used for pub/sub routing. Existing predicate-
  based `broadcast()` is unaffected/unchanged for local-only use.
- **Per-channel topic membership must be tracked, not just per-topic refcounts.**
  The existing `channels` map (`Map<SSEChannel, TMeta>`) has nowhere to record which
  topics a given channel registered on, and `deregister(channel)` takes no `topics`
  argument — so without a second index there is no way to know, at deregister time,
  which topic refcounts to decrement. `SSEChannelGroup` must additionally maintain
  `Map<SSEChannel, Set<topic>>` (or fold topic membership into the existing per-channel
  entry) alongside the topic-level refcount map described below.
- Internally maintains `Map<topic, { refcount, unsubscribe }>`. First local
  registration on a topic calls `pubsub.subscribe(topic, handler)` once; last
  deregistration on that topic calls `unsubscribe()`. Multiple local connections on
  the same topic never create duplicate broker subscriptions.
  - **Race on concurrent register/unsubscribe:** `subscribe()`/`unsubscribe()` may be
    async. The refcount must be incremented/decremented synchronously, before the
    corresponding broker call is awaited, so that a `register()` arriving while an
    `unsubscribe()` for the same topic is still in flight correctly cancels the
    teardown (refcount goes 1 → 0 → 1, not 1 → 0 with the topic entry already removed).
- New method: `publish(topic, signal)`.
  1. Delivers to any locally-held channels registered on `topic` (same as
     `broadcast` today) — works identically with zero `pubsub` configured.
  2. If `pubsub` is configured, **always** also calls `pubsub.publish(topic, signal)`,
     regardless of whether there are any local subscribers on `topic` — remote
     instances may have local subscribers this instance can't see, and the group has
     no way to know that in advance.
- `publish()` to a topic with no local subscribers **and** no `pubsub` configured is a
  no-op, not an error (matches existing `broadcast()` behavior when predicate matches
  nothing). With `pubsub` configured, `publish()` still forwards to the broker per the
  rule above even if locally a no-op.

## Adapter packages (subpath exports, each importing only its own broker's client lib)

```
restale-kit/pubsub-redis    # wraps a user-supplied ioredis (or compatible) client
restale-kit/pubsub-ably     # wraps a user-supplied Ably client
restale-kit/pubsub-pusher   # wraps a user-supplied Pusher client
```

`core` never imports any of these. Users install and pass in exactly one.

## Usage shape

```ts
import { SSEChannelGroup } from 'restale-kit'
import { redisPubSubAdapter } from 'restale-kit/pubsub-redis'

const group = new SSEChannelGroup<Signal, Meta>({
  pubsub: redisPubSubAdapter(redisClient), // omit entirely = single-instance mode
})

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  group.register(channel, { userId }, { topics: [`user:${userId}`] })
  req.on('close', () => group.deregister(channel))
})

// From any instance, with or without a live connection of its own:
group.publish(`user:${userId}`, { key: ['todos'] })
```

## Open questions (resolve before a second adapter is written)

- **Subpath `exports` map**: `package.json` config for `restale-kit/pubsub-redis` etc.
  isn't specified here — needs a pointer to where that lives once implemented.
- **Generic typing across adapter factories**: the relationship between `TSignal` on
  `SSEChannelGroup<TSignal, TMeta>` and on `redisPubSubAdapter<TSignal>(client)` isn't
  pinned down. Left implicit, a mismatch produces a confusing generic error at the
  call site rather than a clear one.
- **Reconnect-window behavior**: adapters own broker reconnect (see above), but it's
  unspecified whether signals published by other instances during an adapter's
  reconnect gap are dropped or buffered. Likely "dropped," consistent with the
  "at most once" non-goal below — worth stating explicitly rather than leaving silent.

## Non-goals (v1)

- No message replay/history for clients that were disconnected when a signal fired —
  matches existing SSE-drops-while-disconnected behavior; document explicitly.
- No delivery guarantees beyond "at most once, per currently-subscribed instance."
- No built-in adapter for queue-style brokers (SQS, plain Kafka consumer groups)
  without an instance-unique ephemeral subscription — out of scope until a concrete
  need arises.
