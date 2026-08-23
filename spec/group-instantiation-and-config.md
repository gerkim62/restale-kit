# `SSEChannelGroup` Instantiation & Configuration Specification

## Overview

The `SSEChannelGroup` class is the central orchestrator in ReStale. Instantiating a group configures:
1. **Cryptographic Identity & Security:** Mandatory connection token signing (`secret`, conditional `scopeBy`).
2. **Schema Validation:** Strict type checking for metadata and client query parameters (`metaSchema`, `clientContextSchema`).
3. **Data Push Resolvers:** Per-connection cache computation (`inlineDataResolver`).
4. **Distributed Clustering:** Multi-instance pub/sub broker integration (`pubsub`, `controlTopic`).
5. **Reconnection & Replay:** History buffer for `Last-Event-ID` reconnection (`eventBufferCapacity`, `eventStore`).
6. **Connection Defaults:** Shared lifetimes, deadline renewals, and keepalive intervals (`channelDefaults`).

---

## TypeScript Options Interface & Conditional Types

To guarantee type safety and prevent dynamic session signature mismatches:
* When `TMeta` is a typed object, **`scopeBy` is strictly required** at compile-time to explicitly declare which stable identity keys are signed into connection tokens.
* When `TMeta` is `undefined` (unauthenticated / public applications), `scopeBy` is optional.

```ts
import type { StandardSchemaV1 } from 'restale-kit'
import type { PubSubAdapter } from 'restale-kit/pubsub'
import type { EventStore, LifetimeOptions, JSONValue } from 'restale-kit'

export interface ChannelDefaults {
  lifetime?: LifetimeOptions
  guardKeepalive?: boolean
  eventBufferCapacity?: number
  keepaliveIntervalMs?: number
  retryIntervalMs?: number
}

interface BaseGroupOptions<TMeta, TClientContext> {
  /**
   * Cryptographic secret used to HMAC-SHA256 sign connection tokens.
   * Required. Must be a non-empty string.
   */
  secret: string

  /**
   * Validates server-side metadata on stream creation.
   * Throws SchemaValidationError on invalid input.
   */
  metaSchema?: StandardSchemaV1<unknown, TMeta>

  /**
   * Validates untrusted client context submitted via POST /sse.
   * Automatically returns HTTP 422 Unprocessable Entity on validation failure.
   */
  clientContextSchema?: StandardSchemaV1<unknown, TClientContext>

  /**
   * Resolves per-connection cache signals and inline payloads during pushInlineData.
   * Required if pushInlineData is called.
   */
  inlineDataResolver?: InlineDataResolver<TMeta, TClientContext>

  /**
   * Hook invoked if the inlineDataResolver omits any active connections on a topic.
   */
  onInlineDataResolverError?: (info: { topic?: string; missingConnectionIds: readonly string[] }) => void

  /**
   * Pub/Sub adapter (Redis, Ably, Pusher) for multi-instance distributed deployments.
   * Required to use group.cluster.* methods.
   */
  pubsub?: PubSubAdapter

  /**
   * Custom control topic name for cluster-wide revocations and context sync.
   * @default '__restale_control__'
   */
  controlTopic?: string

  /**
   * Number of invalidation events retained in memory for Last-Event-ID replay on reconnect.
   * @default undefined (Replay disabled unless configured)
   */
  eventBufferCapacity?: number

  /**
   * Custom external or persistent EventStore implementation for event replay.
   */
  eventStore?: EventStore

  /**
   * Default connection settings applied to all channels created through this group.
   */
  channelDefaults?: ChannelDefaults
}

export type SSEChannelGroupOptions<TMeta = undefined, TClientContext = unknown> =
  BaseGroupOptions<TMeta, TClientContext> &
    ([TMeta] extends [undefined | void]
      ? {
          /**
           * Optional for unauthenticated apps where TMeta is undefined.
           */
          scopeBy?: readonly never[]
        }
      : keyof TMeta & string extends never
      ? {
          /**
           * Optional when TMeta keys cannot be statically resolved.
           */
          scopeBy?: readonly string[]
        }
      : {
          /**
           * Required for authenticated apps. Specify the stable identity keys in TMeta to sign
           * (e.g. ['userId', 'orgId']). Prevents signature mismatches when dynamic session fields shift.
           */
          scopeBy: readonly [keyof TMeta & string, ...(keyof TMeta & string)[]]
        })
```

---

## Options Breakdown & Reference

| Option | Type | Default | Required? | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **`secret`** | `string` | *(None)* | **YES** | Cryptographic secret for HMAC-SHA256 signing of connection tokens. Throws immediately if omitted or empty. |
| **`scopeBy`** | `readonly (keyof TMeta & string)[]` | *(None)* | **Required at compile time when `TMeta` has statically known string keys** | Selects stable identity keys (e.g. `['userId']`) to bind in the HMAC signature. Prevents signature validation failure when dynamic session fields (timestamps, IPs) change. |
| **`metaSchema`** | `StandardSchemaV1` | `undefined` | No | Validates server `meta` on connection open (Zod, Valibot, ArkType). |
| **`clientContextSchema`** | `StandardSchemaV1` | `undefined` | No | Validates untrusted client query parameters on `POST /sse`. |
| **`inlineDataResolver`** | `InlineDataResolver` | `undefined` | Required for `pushInlineData` | Resolves custom cache payloads per connection for `pushInlineData()`. Throws if `pushInlineData` is called without it. |
| **`onInlineDataResolverError`** | `Function` | `undefined` | No | Hook invoked if `inlineDataResolver` omits any matching active connections. |
| **`pubsub`** | `PubSubAdapter` | `undefined` | Required for `group.cluster.*` | Message broker adapter for multi-instance horizontal scaling (Redis, Ably, Pusher). |
| **`controlTopic`** | `string` | `'__restale_control__'` | No | Internal cluster topic for cross-pod revocations and context updates. |
| **`eventBufferCapacity`** | `number` | `undefined` | No | Capacity of the in-memory ring buffer for `Last-Event-ID` reconnection replay. |
| **`channelDefaults`** | `ChannelDefaults` | `undefined` | No | Default lifetime TTLs, deadline renewal policies, and keepalives for child channels. |

---

## Common Instantiation Patterns

### Pattern 1: Minimal Unauthenticated App (Public Feeds / Tickers)
When `TMeta` is `undefined`, `scopeBy` is optional:

```ts
import { SSEChannelGroup } from 'restale-kit/server'

// Unauthenticated public stream (e.g. live ticker, public leaderboard)
export const group = new SSEChannelGroup({
  secret: process.env.RESTALE_SECRET!,
})
```

---

### Pattern 2: Production Authenticated Monolith
When `TMeta` is typed, TypeScript enforces `scopeBy: ['userId']`:

```ts
import { SSEChannelGroup } from 'restale-kit/server'
import { z } from 'zod'

interface UserMeta {
  userId: string
  teamId: string
  lastActiveAt: number // Dynamic field that changes during session!
}

interface ClientCtx {
  page: number
  pageSize: number
  sortBy: 'createdAt' | 'title'
}

interface TodoPayload {
  teamId: string
}

const clientContextSchema = z.object({
  page: z.number().int().min(0),
  pageSize: z.number().int().min(1).max(100),
  sortBy: z.enum(['createdAt', 'title']),
})

export const group = new SSEChannelGroup<UserMeta, ClientCtx>({
  // 1. Mandatory secret
  secret: process.env.RESTALE_SECRET!,

  // 2. Mandatory scopeBy for typed TMeta: binds ONLY stable identity keys!
  // (lastActiveAt will NOT break signatures when it changes mid-session)
  scopeBy: ['userId', 'teamId'],

  // 3. Untrusted client context schema
  clientContextSchema,

  // 4. Last-Event-ID replay buffer (retains last 100 invalidation frames)
  eventBufferCapacity: 100,

  // 5. Per-connection direct cache resolver
  inlineDataResolver: async (connections, payload: TodoPayload) => {
    const todos = await db.todos.findMany({ where: { teamId: payload.teamId } })
    return new Map(connections.map((conn) => {
      const page = conn.clientContext?.page ?? 0
      return [
        conn.connectionId,
        {
          action: 'inlineData',
          signal: { key: ['todos', { page }] },
          inlineData: todos.slice(page * 20, (page + 1) * 20),
        }
      ]
    }))
  },

  // 6. Default channel settings
  channelDefaults: {
    lifetime: { ttlMs: 15 * 60 * 1000 }, // 15-minute connection renewal
    keepaliveIntervalMs: 15000,
  }
})
```

---

### Pattern 3: Full Multi-Instance Distributed Cluster (Redis + Pub/Sub)
For Kubernetes pods, Docker swarms, or horizontally scaled microservices:

```ts
import { SSEChannelGroup } from 'restale-kit/server'
import { redisPubSubAdapter } from 'restale-kit/redis'
import Redis from 'ioredis'
import { z } from 'zod'

interface UserMeta {
  userId: string
}

interface ClientCtx {
  page: number
}

interface TeamDataPayload {
  items: string[]
}

const redis = new Redis(process.env.REDIS_URL!)

export const group = new SSEChannelGroup<UserMeta, ClientCtx>({
  // Mandatory secret
  secret: process.env.RESTALE_SECRET!,
  scopeBy: ['userId'],

  // Distributed Pub/Sub Adapter (with optional payload encryption)
  pubsub: redisPubSubAdapter(redis, {
    encryptionKey: process.env.PUBSUB_ENCRYPTION_KEY,
  }),

  // Client context validation
  clientContextSchema: z.object({ page: z.number() }),

  // Replay capacity on each pod
  eventBufferCapacity: 200,

  // Distributed resolver (runs on whichever pod owns each connection)
  inlineDataResolver: async (connections, payload: TeamDataPayload) => {
    return new Map(connections.map((conn) => [
      conn.connectionId,
      {
        action: 'inlineData',
        signal: { key: ['team-data', conn.clientContext?.page ?? 1] },
        inlineData: payload.items,
      }
    ]))
  }
})
```

---

## Runtime Guards & Constructor Validations

When `new SSEChannelGroup(options)` executes, it performs immediate startup validations:

1. **`secret` Validation:** Must be provided and must be a non-empty string. If omitted or whitespace-only, throws `Error('[SSEChannelGroup] secret is required and must be a non-empty string.')`.
2. **`scopeBy` Validation:** When supplied, runtime checks verify that `scopeBy` is an array and reject any entry that is empty or non-string (throws `Error('[SSEChannelGroup] scopeBy must be an array of non-empty property names.')`). An empty array (`[]`) is permitted at runtime, and runtime validation does not check membership in `TMeta` (which is enforced at compile time).
3. **`eventBufferCapacity` Validation:** If provided, must be a non-negative safe integer (`Number.isSafeInteger(n) && n >= 0`), otherwise throws `RangeError`.
4. **`controlTopic` Validation:** Must be a non-empty, non-whitespace string, otherwise throws `Error`.
5. **PubSub Subscription Initialization:** If `pubsub` is provided, automatically subscribes to `controlTopic` asynchronously and logs any initial broker connection failures.
6. **Cluster Guard:** If any `group.cluster.*` method is called when `pubsub` was not configured, throws `Error('[SSEChannelGroup.cluster] PubSubAdapter is not configured on this group. Use group.local.* or configure pubsub.')`.

---

## Clean Shutdown (`group.dispose()`)

During server shutdown (e.g. `SIGTERM`), call `await group.dispose()` to cleanly terminate all resources:

```ts
process.on('SIGTERM', async () => {
  console.log('Shutting down SSE group...')
  await group.dispose()
  server.close()
})
```

