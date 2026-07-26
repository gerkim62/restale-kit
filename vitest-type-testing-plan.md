# restale-kit — Vitest Type Testing & API Usage Plan

This document outlines the concise usage, type narrowing behavior, and expected TypeScript error boundaries for **every callable API** in `restale-kit`. It serves as the authoritative specification for writing Vitest type-checking tests (using `expectTypeOf` from `vitest` or `@ts-expect-error` assertions) to catch when types become misleading, overly permissive, or broken.

---

## 1. Type Testing Strategy & Vitest Setup

Vitest supports type checking using TypeScript compiler via `vitest typecheck` or `expectTypeOf`:

```ts
import { describe, expectTypeOf, test } from 'vitest'
```

### Key Type Assertions Needed in Tests:
- **`expectTypeOf(val).toEqualTypeOf<T>()`**: Verifies exact type matching.
- **`expectTypeOf(val).toBeCallableWith(...)`**: Verifies valid call signatures.
- **`// @ts-expect-error`**: Verifies invalid parameters, missing required properties, or mismatched generic bounds produce compile-time type errors.

---

## 2. Server Core (`restale-kit/server` / `@/server/core`)

### 2.1 `createSSEChannel<TSignal>(options)`

Creates an isolated SSE channel that produces a standard `ReadableStream<Uint8Array>`.

#### Concise Usage
```ts
import { createSSEChannel } from 'restale-kit/server'
import type { TanStackQuerySignal } from 'restale-kit/types'

const channel = createSSEChannel<TanStackQuerySignal>({
  target: 'tanstack-query',
  keepaliveIntervalMs: 15_000,
  lifetime: { ttlMs: 60_000, onDeadline: 'reconnect' },
  beforeFrame: (ctx) => {
    if (ctx.frameType === 'signal') {
      // ctx.signal is narrowed to TanStackQuerySignal | TanStackQuerySignal[]
      return { action: 'send' }
    }
    return { action: 'send' }
  },
})
```

#### TS Narrowing & Type Assertions
- **`options.target`**: Must be a valid `SignalTarget` (`'tanstack-query' | 'swr' | 'rtk-query' | 'generic'`) or array of targets.
  - ❌ `target: 'invalid-target'` -> `@ts-expect-error`
- **`options.lifetime`**: Discriminator between relative TTL vs absolute deadline.
  - `{ ttlMs: 60000, deadline: 12345 }` -> `@ts-expect-error` (mutually exclusive).
  - `{ ttlMs: 60000, onDeadline: 'invalid' }` -> `@ts-expect-error` (`onDeadline` must be `'reconnect' | 'revoke' | { maxAttempts?: number, retryDelayMs?: number }`).
- **`options.beforeFrame(ctx)`**:
  - `ctx.frameType === 'signal'` narrows `ctx` to `SignalFrameCtx<TSignal>` (`ctx.signal` defined, `InvalidateSignal`).
  - `ctx.frameType === 'keepalive'` narrows `ctx` to `KeepaliveFrameCtx` (`ctx.signal` is `undefined`).
  - Return value must match `FrameGuardResult`: `{ action: 'send' } | { action: 'skip' } | { action: 'close', reason?: string }`.
  - Returning invalid action e.g. `{ action: 'allow' }` -> `@ts-expect-error`.

#### Method Boundaries: `channel.invalidate(signal, customId?)`
- **Single-target channel** (`target: 'tanstack-query'`):
  - `channel.invalidate({ queryKey: ['users'] })` -> Allowed (`target` is auto-filled if omitted on single target).
  - `channel.invalidate({ target: 'swr', key: 'user' })` -> `@ts-expect-error` (target mismatch with channel target type).
- **Multi-target channel** (`target: ['tanstack-query', 'swr']`):
  - `channel.invalidate([{ target: 'tanstack-query', queryKey: ['users'] }, { target: 'swr', key: 'users' }])` -> Allowed (requires explicit `target` on all signals in multi-target array).
  - Omitting `target` property on multi-target signal -> `@ts-expect-error`.

---

### 2.2 `SSEChannelGroup<TSignal, TMeta>(options?)`

Manages a group of channels, metadata filtering, pub/sub sync, and revocation.

#### Concise Usage
```ts
import { SSEChannelGroup } from 'restale-kit/server'
import type { TanStackQuerySignal } from 'restale-kit/types'

interface SessionMeta {
  userId: string
  role: 'admin' | 'user'
}

const group = new SSEChannelGroup<TanStackQuerySignal, SessionMeta>({
  target: 'tanstack-query',
  channelDefaults: {
    lifetime: { ttlMs: 300_000 },
  },
})
```

#### TS Narrowing & Type Assertions
- **`group.register(channel, meta, options?)`**:
  - `meta` parameter requirement depends on `TMeta`:
    - When `TMeta` is non-optional (`SessionMeta`), passing `undefined` or omitting `meta` -> `@ts-expect-error`.
    - When `TMeta` is optional/undefined (`SSEChannelGroup<InvalidateSignal, void>`), `meta` is optional.
  - Passing mismatched metadata shape e.g. `{ userId: 123 }` (number instead of string) -> `@ts-expect-error`.
- **`group.broadcast(signal, predicate)`**:
  - `predicate: (meta: TMeta) => boolean`. Parameter `meta` is inferred as `SessionMeta`.
  - Accessing non-existent meta field e.g. `meta.nonExistent` -> `@ts-expect-error`.
  - `signal` must conform to `TSignal` (or `TSignal[]`).
- **`group.revokeWhere(criteria)`**:
  - `criteria` must be a valid `JSONValue`.
  - Passing functions, symbols, or circular references -> `@ts-expect-error`.
- **`group.revokeByConnectionId(connectionId, scope?)`**:
  - `connectionId`: string.
  - `scope`: `Record<string, JSONValue> | undefined`.

---

### 2.3 `createEventStore<TSignal>(options?)`

In-memory ring buffer for historical event replay.

#### Concise Usage
```ts
import { createEventStore } from 'restale-kit/server'

const store = createEventStore({
  capacity: 200,
  idGenerator: () => `evt_${Date.now()}`,
})

const record = store.add({ target: 'tanstack-query', queryKey: ['items'] })
const result = store.getEventsAfter('evt_123')
// result is EventStoreResult: { events: EventRecord[], stale: boolean }
```

#### TS Narrowing & Type Assertions
- `store.add`: `signal` must be `TSignal | TSignal[]`. Invalid object e.g. `store.add(123)` -> `@ts-expect-error`.
- `store.getEventsAfter`: accepts `lastEventId: string`. Non-string -> `@ts-expect-error`.
- `result.events`: typed as `EventRecord<TSignal>[]`.

---

### 2.4 `mergeChannelDefaults(channelOptions, defaults)`

Helper that merges channel options with group defaults using presence-based rules.

#### Concise Usage
```ts
import { mergeChannelDefaults } from 'restale-kit/server'

const merged = mergeChannelDefaults(
  { target: 'tanstack-query', guardKeepalive: false },
  { guardKeepalive: true }
)
// merged.guardKeepalive === false
```

#### TS Narrowing & Type Assertions
- Accepts `(channelOptions: SSEChannelOptions, defaults: ChannelDefaults | undefined)`.
- Returns `SSEChannelOptions`.

---

## 3. Server Transports (`restale-kit/server` / adapters)

### 3.1 Node.js / Express / Fastify Adapter: `attachSSE<TSignal>(req, res, options, group?)`

#### Concise Usage
```ts
import { attachSSE } from 'restale-kit/server/node' // or restale-kit/server/express / fastify

app.get('/api/sse', (req, res) => {
  const channel = attachSSE(req, res, {
    target: 'tanstack-query',
  })
})
```

#### TS Narrowing & Type Assertions
- `req`: Must accept `IncomingMessage` or `FastifyRequestLike` (has `url` and `headers`).
- `res`: Must accept `ServerResponse` or `FastifyReplyLike` (has `setHeader`, `writeHead`, `end`).
- Invalid request object without `url` / `headers` -> `@ts-expect-error`.

---

### 3.2 Fetch / Web Standard / Hono Adapter: `toSSEResponse<TSignal>(request, options, group?)`

#### Concise Usage
```ts
import { toSSEResponse } from 'restale-kit/server/fetch' // or restale-kit/server/hono

export async function GET(request: Request) {
  const { response, channel } = toSSEResponse(request, {
    target: 'tanstack-query',
  })
  return response
}
```

#### TS Narrowing & Type Assertions
- `request`: Must accept `Request` object.
- Returns `{ response: Response; channel: SSEChannel<TSignal> }`.
- Accessing non-existent return property -> `@ts-expect-error`.

---

### 3.3 Extraction Utilities (`extractConnectionId`, `extractRequestedTarget`, `extractLastEventId`)

#### Concise Usage
```ts
import { extractConnectionId, extractRequestedTarget, extractLastEventId } from 'restale-kit/server'

const cid = extractConnectionId('http://localhost/sse?__restale_cid__=abc') // string | undefined
const target = extractRequestedTarget('http://localhost/sse?__restale_target__=swr') // string | undefined
const lastId = extractLastEventId(req.headers) // string | undefined
```

---

## 4. Pub/Sub Adapters & Envelope (`restale-kit/pubsub`)

### 4.1 PubSub Adapters (`redisPubSubAdapter`, `ablyPubSubAdapter`, `pusherPubSubAdapter`)

#### Concise Usage
```ts
import { redisPubSubAdapter } from 'restale-kit/pubsub/redis'
import { ablyPubSubAdapter } from 'restale-kit/pubsub/ably'
import { pusherPubSubAdapter } from 'restale-kit/pubsub/pusher'

const redisPubSub = redisPubSubAdapter({
  redisUrl: 'redis://localhost:6379',
  encryptionKey: 'base64_or_hex_key_32_bytes_minimum...',
})
```

#### TS Narrowing & Type Assertions
- Returns `PubSubAdapter` interface (`subscribe`, `publish`).
- Mutually exclusive options e.g. `{ encrypt: false, encryptionKey: '...' }` -> `@ts-expect-error` or runtime error.

---

### 4.2 Envelope Helpers (`wrapEnvelope`, `unwrapEnvelope`, `encryptPayload`, `decryptPayload`)

#### Concise Usage
```ts
import { wrapEnvelope, unwrapEnvelope, encryptPayload, decryptPayload } from 'restale-kit/pubsub'

const env = wrapEnvelope('node-1', { kind: 'signal', data: { queryKey: ['items'] } })
const msg = unwrapEnvelope(env, 'node-2')
```

#### TS Narrowing & Type Assertions
- `unwrapEnvelope`: Returns `PubSubMessage<T> | null`. Must handle null check before accessing `msg.kind`.
  - Accessing `msg.kind` without checking `msg !== null` -> Allowed by TS if strictNullChecks is off, but with strict null checks TS requires narrowing `msg !== null`.

---

## 5. Client Core (`restale-kit/client/core`)

### 5.1 `SSEInvalidatorClient<TSignal>(url, opts?)`

Framework-agnostic SSE client extending `EventTarget`.

#### Concise Usage
```ts
import { SSEInvalidatorClient } from 'restale-kit/client/core'
import type { TanStackQuerySignal } from 'restale-kit/types'

const client = new SSEInvalidatorClient<TanStackQuerySignal>('/api/sse', {
  autoReconnect: { native: true, jsBackoff: true },
  reconnect: { maxRetries: 5, baseDelayMs: 1000 },
  withCredentials: true,
})

client.addEventListener('invalidate', (event) => {
  // event is CustomEvent<TanStackQuerySignal | TanStackQuerySignal[]>
  const signal = event.detail
})

client.addEventListener('statuschange', (event) => {
  // event.detail is ConnectionStatus
  if (event.detail.status === 'closed') {
    // event.detail.reason is 'manual' | 'unmount' | 'revoked' | 'rejected'
  }
})

client.addEventListener('revoke', (event) => {
  // event.detail is RevokeEventDetail
  if (event.detail.reason === 'unsupported-target') {
    // event.detail.requested (string), event.detail.supported (string[])
  }
})
```

#### TS Narrowing & Type Assertions
- **`status` Property**: `client.status` returns `ConnectionStatus`:
  - `status === 'connecting'`
  - `status === 'open'`
  - `status === 'closed'` (`reason`: `'manual' | 'unmount' | 'revoked'`)
  - `status === 'closed'` with `reason: 'rejected'` (`response`: `RejectedConnectionResponse`)
  - `status === 'error'` (`error`: `Event`)
- **Event Listeners**:
  - Listening to unknown event e.g. `client.addEventListener('unknown', ...)` -> `@ts-expect-error` when using typed overload.
  - Event detail narrowing:
    - `'invalidate'`: `CustomEvent<TSignal | TSignal[]>`.
    - `'revoke'`: `CustomEvent<RevokeEventDetail>`. Checking `detail.reason === 'unsupported-target'` narrows `detail` to include `requested` and `supported`.
    - `'renew'`: `CustomEvent<RenewEventDetail>` (`reason: 'deadline'`, `maxAttempts: number`, `retryDelayMs: number`).

---

## 6. Client Adapters (`restale-kit/client/tanstack-query`, `restale-kit/client/swr`)

### 6.1 `tanstackQueryAdapter` & `useTanstackQueryAdapter`

#### Concise Usage
```ts
import { tanstackQueryAdapter, useTanstackQueryAdapter } from 'restale-kit/client/tanstack-query'
import { QueryClient } from '@tanstack/react-query'

const queryClient = new QueryClient()

// Plain adapter function
const adapterFn = tanstackQueryAdapter(queryClient)
// Returns AdaptedInvalidateCallback<'tanstack-query', InvalidateSignal>

// React hook version
const onInvalidate = useTanstackQueryAdapter(queryClient)
// Returns AdaptedInvalidateCallback<'tanstack-query', InvalidateSignal>
```

#### TS Narrowing & Type Assertions
- Return value has phantom brand `__restaleTarget: 'tanstack-query'`.
- `expectTypeOf(onInvalidate.__restaleTarget).toEqualTypeOf<'tanstack-query'>()`.

---

### 6.2 `swrAdapter` & `useSwrAdapter`

#### Concise Usage
```ts
import { swrAdapter, useSwrAdapter } from 'restale-kit/client/swr'
import { mutate } from 'swr'

const adapterFn = swrAdapter(mutate, {
  toInvalidateKey: (key) => (typeof key === 'string' ? [key] : undefined),
})
// Returns AdaptedInvalidateCallback<'swr', InvalidateSignal>
```

#### TS Narrowing & Type Assertions
- Return value has phantom brand `__restaleTarget: 'swr'`.
- `expectTypeOf(onInvalidate.__restaleTarget).toEqualTypeOf<'swr'>()`.

---

## 7. React Integration (`restale-kit/client/react`)

### 7.1 `useReStale(url, options)`

React hook that manages SSE client lifecycle and status via `useSyncExternalStore`.

#### Concise Usage
```ts
import { useReStale } from 'restale-kit/client/react'
import { useTanstackQueryAdapter } from 'restale-kit/client/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'

function MyComponent() {
  const queryClient = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(queryClient)

  const { connectionId, connection, reconnect, close } = useReStale('/api/sse', {
    onInvalidate, // Target 'tanstack-query' is inferred automatically from adapter brand!
  })
}
```

#### TS Narrowing & Type Assertions
- **Automatic Target Inference**:
  - `onInvalidate` carries `AdaptedInvalidateCallback<'tanstack-query'>`.
  - Omitting `target` option is valid and infers `TTarget = 'tanstack-query'`.
- **Target Mismatch Error Protection**:
  - Explicitly specifying `target: 'swr'` when `onInvalidate` is a TanStack adapter -> `@ts-expect-error`!
  ```ts
  // ❌ MUST FAIL TYPE CHECKING:
  useReStale('/api/sse', {
    onInvalidate, // branded 'tanstack-query'
    target: 'swr', // ❌ Compile error: 'swr' is not assignable to 'tanstack-query'
  })
  ```
- **`onRevoke` Narrowing**:
  - `onRevoke: (detail) => { if (detail.reason === 'unsupported-target') { detail.supported } }`

---

## 8. Protocol & Schema Utilities (`restale-kit/types`)

### 8.1 Schema Validation & Matching Functions

#### Concise Usage
```ts
import {
  isJSONValue,
  isJSONValueArray,
  matchesInvalidateSignalKey,
  matchesJSONValue,
  validateStandardSchema,
} from 'restale-kit/types'

if (isJSONValue(val)) {
  // val narrowed to JSONValue
}

if (isJSONValueArray(key)) {
  // key narrowed to JSONValue[]
}

const matches = matchesInvalidateSignalKey(['users', { id: 1 }], {
  target: 'tanstack-query',
  queryKey: ['users'],
})
```

#### TS Narrowing & Type Assertions
- `isJSONValue(x)`: User-defined type guard `x is JSONValue`.
- `isJSONValueArray(x)`: User-defined type guard `x is JSONValue[]`.
- `validateStandardSchema(value, schema)`: Returns schema output type `TOutput`.

---

## 9. Comprehensive Type Test Assertion Matrix

Below is a quick reference matrix of expected TypeScript behavior for tests to cover:

| Component / Function | Scenario | Expected TS Behavior |
| :--- | :--- | :--- |
| `createSSEChannel` | `target: 'unknown'` | ❌ `@ts-expect-error` (Invalid `SignalTarget`) |
| `createSSEChannel` | Both `ttlMs` and `deadline` set in `lifetime` | ❌ `@ts-expect-error` (Mutually exclusive union) |
| `createSSEChannel` | Invalidate signal target doesn't match channel | ❌ `@ts-expect-error` (Target mismatch) |
| `SSEChannelGroup` | `register()` with missing `meta` when `TMeta` is required | ❌ `@ts-expect-error` (Missing required param) |
| `SSEChannelGroup` | `broadcast(signal, pred)` -> `pred(meta)` | ✅ `meta` typed as `TMeta` |
| `useReStale` | `onInvalidate` from `useTanstackQueryAdapter` | ✅ `target` inferred as `'tanstack-query'` |
| `useReStale` | `onInvalidate` (tanstack) + `target: 'swr'` | ❌ `@ts-expect-error` (Mismatched target override) |
| `SSEInvalidatorClient` | `client.addEventListener('invalid_event', ...)` | ❌ `@ts-expect-error` (Event name not in event map) |
| `SSEInvalidatorClient` | `client.addEventListener('revoke', ev)` | ✅ `ev.detail` is `RevokeEventDetail` |
| `unwrapEnvelope` | Returns `PubSubMessage<T> \| null` | ✅ Null check required for property access |

---

## Next Steps for Vitest Type Testing

1. Create `src/types/type-check.test-d.ts` (or `*.test-d.ts` files matching module locations).
2. Write `describe` blocks using `expectTypeOf` and `//@ts-expect-error` for every boundary specified above.
3. Run `pnpm run typecheck` or `npx vitest typecheck` to continuously enforce type safety contracts.
