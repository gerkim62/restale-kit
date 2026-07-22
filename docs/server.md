# Server Guide

The server side has two concerns:
1. **Accepting SSE connections** — using a framework adapter to create an `SSEChannel` per client.
2. **Broadcasting invalidations** — using `SSEChannelGroup` to send signals to the right clients.

---

## Establishing channels via `SSEChannelGroup`

In v1.0, `SSEChannelGroup` is the single entry point for establishing and managing channels. Creating and registering channels occurs atomically in a single method call:
- `group.createChannel(request, options)` for **Fetch API runtimes** (Hono, Bun, Deno, Edge, Next.js).
- `group.attachChannel(req, res, options)` for **Node.js HTTP runtimes** (Express, Fastify, Node `http`).

All channel methods set the required SSE response headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-ReStale-Target: <target>`). They also emit `X-ReStale-Supported: <comma-separated-targets>` listing supported targets. Disconnect detection and auto-deregistration on stream close are wired automatically.

### Express

```ts
import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'

const app = express()
const group = new SSEChannelGroup({
  channelDefaults: { target: 'swr' },
})

app.get('/sse', (req, res) => {
  group.attachChannel(req, res, {
    meta: { userId: req.user?.id },
  })
})
```

### Native Node.js `http`

```ts
import http from 'node:http'
import { SSEChannelGroup } from 'restale-kit/server'

const group = new SSEChannelGroup({
  channelDefaults: { target: 'swr' },
})

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  if (req.method === 'GET' && url.pathname === '/sse') {
    group.attachChannel(req, res, {
      meta: { userId: req.user?.id },
    })
  }
})
```

### Fastify

`group.attachChannel` accepts either Fastify's wrapped `request`/`reply` objects or the raw Node objects. When passing Fastify objects, `attachChannel` automatically calls `reply.hijack()` for you.

```ts
import Fastify from 'fastify'
import { SSEChannelGroup } from 'restale-kit/server'

const group = new SSEChannelGroup({
  channelDefaults: { target: 'swr' },
})
const app = Fastify()

app.get('/sse', (request, reply) => {
  group.attachChannel(request, reply, {
    meta: { userId: request.user?.id },
  })
})
```

### Hono & Fetch API (Cloudflare Workers, Bun, Deno, edge)

Fetch-API runtimes return both the `Response` object and the `SSEChannel` reference.

```ts
import { Hono } from 'hono'
import { SSEChannelGroup } from 'restale-kit/server'

const app = new Hono()
const group = new SSEChannelGroup({
  channelDefaults: { target: 'swr' },
})

app.get('/sse', (c) => {
  const { response } = group.createChannel(c.req.raw, {
    meta: { userId: c.req.header('X-User-ID') },
  })
  return response
})
```

---

## `SSEChannelGroup`

`SSEChannelGroup` manages all connected clients and is where you send invalidation signals and control revocations.

```ts
import { SSEChannelGroup } from 'restale-kit/server'

const group = new SSEChannelGroup()

// With typed metadata
interface ClientMeta {
  userId: string
  roles: string[]
}
const typedGroup = new SSEChannelGroup<InvalidateSignal, ClientMeta>()
```

**Constructor options:**

| Option | Type | Description |
|---|---|---|
| `metaSchema` | `StandardSchemaV1` | Validates metadata on `register()`. Throws `SchemaValidationError` on failure. |
| `pubsub` | `PubSubAdapter` | Distributed pub/sub adapter for multi-instance deployments. See [Pub/Sub guide](./pubsub.md). |
| `eventBufferCapacity` | `number` | Enables Last-Event-ID history replay buffer up to `N` events. |
| `eventStore` | `EventStore` | Custom event store for persistent or externally managed replay storage. |
| `controlTopic` | `string` | Custom control topic name for cross-cluster revocations (default: `'__restale_control__'`). |
| `channelDefaults` | `ChannelDefaults` | Frame Guard defaults (`lifetime`, `guardKeepalive`) applied to channels that don't set them directly. Pass `group` to `attachSSE()`/`toSSEResponse()` so the merge is applied automatically. `beforeFrame` is not supported here — it is per-connection by nature. |

---

## `register` and `deregister`

```ts
// If TMeta accepts undefined, metadata is optional:
group.register(channel)

// If TMeta does not accept undefined, metadata is required:
group.register(channel, meta)

// With topics routing:
group.register(channel, meta, { topics: ['user:42', 'global'] })

group.deregister(channel)
```

- `meta` is optional only when `TMeta` accepts `undefined`. If it does not accept `undefined`, metadata must be provided.
- Omitting `meta` (or passing `undefined`) registers `undefined` as metadata, meaning the channel has no metadata properties. See [Broadcasting without metadata](#broadcasting-without-metadata) and [Revocation without metadata](#revocation-without-metadata) for the implications.
- `topics` is an optional list of pub/sub topic strings this connection subscribes to. Only relevant when using a pub/sub adapter.

**Automatic cleanup:** When a channel closes (peer disconnect, server `close()`, or stream cancellation), it is automatically deregistered from the group. You do not need a manual `req.on('close', ...)` listener for cleanup. `group.deregister(channel)` is still available if you need to remove a channel before it closes.

---

## Broadcasting

### `broadcastToAll(signal)` — all clients

```ts
// Invalidate the 'todos' key for every connected client
group.broadcastToAll({ key: ['todos'] })

// Invalidate everything (useful after a deployment)
group.broadcastToAll({ key: [] })

// Batch: multiple signals in one SSE frame
group.broadcastToAll([
  { key: ['todos'] },
  { key: ['todos-count'] },
])
```

`broadcastToAll` reaches **all** registered channels, including those registered without metadata.

### `broadcast(signal, predicate)` — filtered broadcast (preferred)

Use a predicate against each channel's registered metadata to scope the invalidation:

```ts
// Only invalidate for a specific user
group.broadcast(
  { key: ['todos', { userId: '42' }] },
  (meta) => meta.userId === '42'
)

// Invalidate admin data only for admin users
group.broadcast(
  { key: ['admin-data'] },
  (meta) => meta.roles.includes('admin')
)
```

The predicate receives `TMeta` directly — when `TMeta` includes `undefined` (i.e. metadata was omitted on registration), the predicate receives `undefined` and must handle it explicitly.

### `broadcastByKey(signal)` — automatic key-based matching

Broadcasts to channels whose registered metadata matches the signal's key using hierarchical prefix/exact matching semantics.

```ts
group.broadcastByKey({ key: ['todos', { userId }] })
```

The signal's `key` is matched against each channel's registered metadata (which can be a JSON array key or an object/scalar value automatically matched against the signal key). A channel receives the signal when its registered metadata matches or extends the signal key (when `exact: true`, keys must match exactly).

### Broadcasting without metadata

Channels registered without metadata (`group.register(channel)`, no `meta` argument) have `undefined` metadata. They are included in `broadcastToAll` and in `broadcast` calls — the predicate receives `undefined` for those channels. They are **excluded** from `broadcastByKey` because `undefined` is not a valid JSON value and cannot participate in key-based matching.

---

## Connection Lifecycle: Lifetime & Reconnection Guards

The **Frame Guard** feature allows you to enforce automatic connection renewal on a deadline (e.g., tied to authentication token expiry) and to gate outgoing signals with custom guards before they are sent to clients.

### Connection Lifetime & Deadline Renewal

A channel can have an absolute or relative deadline after which it must be renewed:

```ts
// Relative: expire after 5 minutes
const channel = attachSSE(req, res, {
  target: 'swr',
  lifetime: { ttlMs: 5 * 60 * 1000 }
})

// Absolute: expire at the token's exp claim (epoch ms)
const channel = attachSSE(req, res, {
  target: 'swr',
  lifetime: { deadline: tokenPayload.exp * 1000 }
})
```

When the deadline approaches (after applying jitter to prevent thundering herds), the channel sends a `renew` SSE event frame to the client. The client then makes confirmatory reconnect attempt(s) through your real authentication middleware, allowing the server to refresh the client's session or reject the renewal based on auth state. The number of attempts is controlled by `maxAttempts` (default: 1).

The `renew` frame includes:
- `maxAttempts` — how many times the client should retry if the reconnect fails (default: 1)
- `retryDelayMs` — milliseconds to wait between retry attempts (default: 250ms)

If the client's confirmatory reconnect succeeds, the connection is resumed from the new channel. If all attempts exhaust, the client closes.

By default, when deadline fires, a `renew` frame is sent (equivalent to `onDeadline: 'reconnect'`). To send a terminal `revoke` instead (for cases where the deadline itself is authoritative, such as a signed token's `exp`), use:

```ts
lifetime: { deadline: tokenExp, onDeadline: 'revoke' }
```

Or customize the `maxAttempts` / `retryDelayMs` values sent in the `renew` frame:

```ts
lifetime: {
  ttlMs: 5 * 60 * 1000,
  onDeadline: { maxAttempts: 2, retryDelayMs: 500 }
}
```

### Frame Guard (`beforeFrame`)

Before each outgoing signal frame (and optionally keepalive frames), you can run a custom synchronous guard function to inspect or reject the frame:

```ts
const channel = attachSSE(req, res, {
  target: 'swr',
  beforeFrame: (ctx) => {
    // ctx.signal: the signal about to be sent (undefined for keepalive)
    // ctx.frameType: 'signal' or 'keepalive'
    // ctx.connectionId: the connection ID
    // ctx.requestedTarget: the client's requested target (if any)
    // ctx.isResume: true if this connection started from Last-Event-ID

    if (/* client no longer has permission */) {
      return { action: 'close', reason: 'permission-denied' }
    }
    return { action: 'send' }
  },
  // By default, beforeFrame runs before signal frames only.
  // Set guardKeepalive: true to also run it before keepalive ticks (if keepalive is enabled).
  keepaliveIntervalMs: 5000,
  guardKeepalive: false,
})
```

The guard function must be synchronous and can return one of three results:

| Result | Effect |
|---|---|
| `{ action: 'send' }` | Frame is sent normally. |
| `{ action: 'skip' }` | Frame is silently dropped; connection stays open. Useful for rate-limiting or sampling. |
| `{ action: 'close', reason?: string }` | Send a terminal `revoke` frame with the supplied reason, then close the connection. No auto-reconnect. |

Errors thrown in `beforeFrame` are treated as `{ action: 'close' }`.

### Distributing defaults via `channelDefaults`

In a multi-channel group, you can distribute Frame Guard settings to all channels created through the group:

```ts
const group = new SSEChannelGroup({
  channelDefaults: {
    target: 'swr',
    lifetime: { ttlMs: 5 * 60 * 1000 },
    guardKeepalive: true,
  }
})

app.get('/sse', (req, res) => {
  group.attachChannel(req, res, {
    meta: { userId: req.user.id },
    // Channel-specific options can override defaults:
    // lifetime: { ttlMs: 10 * 60 * 1000 }
  })
})
```

---

## Connection Revocation

To actively close client connections (e.g., on logout, session expiration, or user ban), the group provides two dedicated APIs.

### Criteria-Based Revocation (`revokeWhere()`)

Closes all channels whose metadata matches `criteria` via subset matching. If a pub/sub adapter is configured, also broadcasts to the control topic so remote instances close matching connections.

Before closing each channel, `revokeWhere` sends a terminal `revoke` SSE event frame to the client. The client receives this frame, sets its status to `{ status: 'closed', reason: 'revoked' }`, suppresses automatic reconnection, and calls `onRevoke` if provided. This distinguishes an intentional server kick from a transient network error.

```ts
// Close all connections for user-42 across the entire cluster
await group.revokeWhere({ userId: 'user-42' })
```

Returns `{ localClosed: number }`.

### Connection-Specific Revocation (`revokeByConnectionId()`)

Closes the single channel identified by `connectionId`. Pass `scope` (a partial metadata object) to verify ownership before closing — if the channel's metadata does not match `scope`, nothing happens and `{ closed: false }` is returned.

Like `revokeWhere`, this sends a terminal `revoke` SSE event frame to the client before closing the channel. The client will not auto-reconnect after receiving it.

When a pub/sub adapter is configured, `revokeByConnectionId` automatically broadcasts a control message to the cluster so that the connection is revoked on whichever server instance it is currently connected to.

```ts
// Close one specific connection, scoped to the requesting user
const result = await group.revokeByConnectionId(connectionId, { userId: req.user.id })
// result: { closed: boolean }
```

### Revocation without metadata

Channels registered without metadata (`group.register(channel)`, no `meta` argument) **cannot be targeted by `revokeWhere()`**. Omitting metadata registers `undefined` as metadata. Because `undefined` is not a valid JSON value, criteria matching is skipped entirely for those channels — even `revokeWhere({})` returns `localClosed: 0` for them.

To revoke a channel that has no metadata, use `revokeByConnectionId(connectionId)` instead:

```ts
// ❌ Does not work — revokeWhere cannot match channels with undefined meta
await group.revokeWhere({})

// ✅ Works — revokeByConnectionId looks up by connectionId, bypassing metadata matching
await group.revokeByConnectionId(channel.connectionId)
```

If you need criteria-based revocation, always register channels with explicit metadata.

### Security: always scope client-supplied connection IDs

`connectionId` is generated as a UUID by the client package and is useful for correlating a logout request with one SSE connection. It is **not** an authentication credential: a client can submit any value to an HTTP endpoint. Do not use a bare `revokeByConnectionId(connectionId)` call in a request handler.

Register trusted identity metadata from your authentication layer (at least `userId`; use a server-authenticated `sessionId` when available), then include that metadata in the `scope` of `revokeByConnectionId(...)` or in the criteria of `revokeWhere(...)`. This ensures that an arbitrary or leaked connection ID cannot revoke a connection outside the authenticated user's/session's scope. UUID unguessability reduces accidental discovery, but is not authorization. Always pass `scope` with trusted server-side identity (e.g. `{ userId: req.user.id }`) so that a forged or leaked `connectionId` cannot close another user's connection.

If the client does not send a connection ID, revoke the trusted session instead using criteria-based revocation; this may close more than one tab:

```ts
await group.revokeWhere({
  userId: req.user.id,
  sessionId: req.session.id,
})
```

When a pub/sub adapter is configured, `revokeWhere()` automatically broadcasts control messages across the cluster to reach matching connections on other server instances.

---

## Reconnection & Event History Replay

To prevent missed invalidation signals during momentary network drops, create a shared `eventStore` and pass it to both `SSEChannelGroup` and your transport helper (`attachSSE` / `toSSEResponse`):

```ts
import { createEventStore, SSEChannelGroup } from 'restale-kit/server'

// Shared event store (retains history for Last-Event-ID replay)
const eventStore = createEventStore({ capacity: 100 })
const group = new SSEChannelGroup({
  channelDefaults: { target: 'swr' },
  eventStore,
})

app.get('/sse', (req, res) => {
  // group.attachChannel automatically connects eventStore to channels
  group.attachChannel(req, res, {
    meta: { userId: req.user.id },
  })
})
```

When a client reconnects sending the standard `Last-Event-ID` HTTP header (enforced up to a maximum length of 512 bytes for security protection), `attachSSE`/`toSSEResponse` extracts the header and passes `eventStore` to the channel, which automatically replays missed invalidation events in sequence before resuming the live stream.

> **Tip — pair with Frame Guard lifetime:** If you use `lifetime: { onDeadline: 'reconnect' }` (the default), configure a shared `eventStore` at the same time. During the brief close-and-reconnect window triggered by a deadline, any signals sent by the server may not be delivered to the client. An `eventStore` ensures those signals are replayed when the client reconnects with `Last-Event-ID`.

---

## Teardown (`dispose()`)

Call `group.dispose()` during graceful server shutdown to unsubscribe control topic listeners without force-closing client channels:

```ts
process.on('SIGTERM', async () => {
  await group.dispose()
  server.close()
})
```
