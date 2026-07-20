# API Reference

Complete export surface for every `restale-kit` subpath. All subpaths are ESM-only.

---

## `restale-kit` — core types and errors

```ts
import type {
  JSONValue,
  ReStaleSignal,
  InvalidateSignal,
  TanStackQuerySignal,
  SWRSignal,
  RTKQuerySignal,
  GenericInvalidateSignal,
  SSEInvalidateEvent,
  ChannelState,
  StandardSchemaV1,
} from 'restale-kit'
import {
  ChannelClosedError,
  SchemaValidationError,
  SIGNAL_TARGETS,
  isJSONValue,
  isJSONValueArray,
  matchesInvalidateSignalKey,
  validateStandardSchema,
} from 'restale-kit'
```

### Types

```ts
type JSONValue =
  | string | number | boolean | null
  | JSONValue[]
  | { [key: string]: JSONValue }

const SIGNAL_TARGETS: {
  readonly TANSTACK: 'tanstack-query'
  readonly SWR: 'swr'
  readonly RTK: 'rtk-query'
  readonly GENERIC: 'generic'
}

interface TanStackQuerySignal {
  target: 'tanstack-query'
  queryKey: JSONValue[]
  exact?: boolean
  type?: 'active' | 'inactive' | 'all'
  action?: 'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel'
  stale?: boolean
}

interface SWRSignal {
  target: 'swr'
  key: string | JSONValue[]
  action?: 'revalidate' | 'purge' | 'remove'
  revalidate?: boolean
  match?: 'exact' | 'prefix'
}

interface RTKQuerySignal {
  target: 'rtk-query'
  tags: Array<string | { type: string; id?: string | number }>
}

interface GenericInvalidateSignal {
  target?: 'generic'
  key: JSONValue[]
  exact?: boolean
  action?: 'invalidate' | 'refetch' | 'remove'
}

type ReStaleSignal =
  | TanStackQuerySignal
  | SWRSignal
  | RTKQuerySignal
  | GenericInvalidateSignal

type InvalidateSignal = ReStaleSignal

type SSEInvalidateEvent = InvalidateSignal | InvalidateSignal[]

type ChannelState = 'open' | 'closed'
```

### Utilities

- `isJSONValue(value: unknown): value is JSONValue`: Checks if a value is JSON-serializable.
- `isJSONValueArray(value: unknown): value is JSONValue[]`: Checks if a value is an array of JSON-serializable elements.
- `matchesInvalidateSignalKey(cacheKey: JSONValue, signal: ReStaleSignal): boolean`: Determines whether a cache key matches a given signal.
- `validateStandardSchema<T>(value: unknown, schema: StandardSchemaV1<unknown, T>): T`: Synchronously validates input against a Standard Schema v1 compliance object.

### Errors


```ts
class ChannelClosedError extends Error {
  readonly name: 'ChannelClosedError'
  // Thrown by channel.invalidate() when state is 'closed'
}

class SchemaValidationError extends Error {
  readonly name: 'SchemaValidationError'
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>
  // Thrown when signal or metadata validation fails
}
```

---

## `restale-kit/server`

```ts
import { createSSEChannel, SSEChannelGroup, createEventStore } from 'restale-kit/server'
import type { SSEChannel, SSEChannelOptions } from 'restale-kit/server'
import type { EventStore, EventStoreOptions, EventRecord, EventStoreResult } from 'restale-kit/server'
```

### `createSSEChannel(options)`

```ts
function createSSEChannel<TSignal extends InvalidateSignal = InvalidateSignal>(
  options: SSEChannelOptions<TSignal>
): SSEChannel<TSignal>

interface SSEChannelOptions<TSignal> {
  target: SignalTarget | SignalTarget[]               // required target discriminator ('tanstack-query' | 'swr' | 'rtk-query' | 'generic')
  keepaliveIntervalMs?: number                        // default 0 (disabled)
  retryIntervalMs?: number                            // optional retry interval in ms for browser EventSource
  signalSchema?: StandardSchemaV1<unknown, TSignal>
  lastEventId?: string
  eventStore?: EventStore<TSignal>
  eventBufferCapacity?: number
  idGenerator?: () => string
  connectionId?: string                               // unique connection ID from client
  requestedTarget?: SignalTarget                      // target requested by the client via __restale_target__ query param
}

interface SSEChannel<TSignal> {
  readonly state: ChannelState
  readonly connectionId: string                       // unique connection ID from client
  readonly target: SignalTarget | SignalTarget[]       // configured target discriminator; required
  readonly requestedTarget: SignalTarget | undefined  // target requested by this client via __restale_target__, if any
  readonly stream: ReadableStream<Uint8Array>
  /**
   * Enqueues a signal (or array of signals) into the SSE stream.
   *
   * Returns the SSE event ID string assigned to this frame. By default without an
   * `eventStore` or `eventBufferCapacity` configured, IDs are absent or empty (`''`).
   * Caller-supplied `customId` or custom `idGenerator` values may still be emitted
   * without an event store, but such IDs cannot be replayed without history.
   * When an `eventStore` or `eventBufferCapacity` is configured, event IDs are recorded
   * for `Last-Event-ID` replay upon reconnect.
   *
   * Throws `ChannelClosedError` when `state` is `'closed'`.
   * Throws `SchemaValidationError` when `signalSchema` validation fails.
   */
  invalidate(signal: TSignal | TSignal[], customId?: string): string
  close(): void                                       // server-initiated close; idempotent
  disconnect(): void                                  // called by transport on peer disconnect; idempotent
  /**
   * Sends a terminal `revoke` SSE event to the client, then closes the channel.
   * The client will NOT auto-reconnect after receiving this frame.
   * Idempotent — no-op if the channel is already closed.
   */
  revoke(reason?: string): void                       // default reason: 'revoked'
  onClose(callback: () => void): void                 // register callback for when channel closes
}
```

### `SSEChannelGroup(options?)`

```ts
class SSEChannelGroup<
  TSignal extends InvalidateSignal = InvalidateSignal,
  TMeta = unknown
> {
  constructor(options?: {
    metaSchema?: StandardSchemaV1<unknown, TMeta>
    pubsub?: PubSubAdapter<TSignal>
    eventStore?: EventStore<TSignal>
    eventBufferCapacity?: number
    controlTopic?: string                             // default '__restale_control__'
  })

  readonly size: number
  readonly controlTopic: string
  readonly eventStore?: EventStore<TSignal>

  register(
    channel: SSEChannel<TSignal>,
    ...args: undefined extends TMeta
      ? [meta?: TMeta, options?: { topics?: string[] }]
      : [meta: TMeta, options?: { topics?: string[] }]
  ): void
  // Omitting meta (or passing undefined) sets metadata to undefined.
  // Channels without metadata are included in broadcastToAll and broadcast(),
  // excluded from broadcastByKey(), and cannot be targeted by revokeWhere().
  // Use revokeByConnectionId(connectionId) to revoke them.

  deregister(channel: SSEChannel<TSignal>): void

  broadcast(
    signal: TSignal | TSignal[],
    predicate: (meta: TMeta) => boolean
  ): void

  broadcastToAll(signal: TSignal | TSignal[]): void

  broadcastByKey(signal: TSignal): void

  publish(topic: string, signal: TSignal | TSignal[]): Promise<void>

  revokeWhere(criteria: JSONValue): Promise<{ localClosed: number }>
  // Sends a terminal revoke SSE frame to each matched client before closing.
  // Client receives { status: 'closed', reason: 'revoked' } and does NOT auto-reconnect.
  // Channels registered without metadata cannot be matched by revokeWhere().
  // Use revokeByConnectionId(connectionId) to revoke those channels instead.
  revokeByConnectionId(connectionId: string, scope?: Record<string, JSONValue>): Promise<{ closed: boolean }>
  // Also sends a terminal revoke frame before closing. Same client-side behavior as revokeWhere.
  dispose(): Promise<void>
}
```

### `revokeWhere(criteria)` security

`criteria` subset-matches connection metadata. If a criterion includes a client-supplied `connectionId`, also include trusted metadata from your authentication layer (for example, `userId` and `sessionId`). A connection ID is an opaque correlation value, not proof that a caller is authorized to revoke that connection.

### `controlTopic` and multi-group deployments

Each `SSEChannelGroup` subscribes to its `controlTopic` on the pub/sub adapter to receive cross-instance revocation messages. The default topic name is `'__restale_control__'`.

If you create **multiple `SSEChannelGroup` instances that share the same pub/sub adapter** (e.g. one group per tenant, or one group per resource type), each group must be given a unique `controlTopic`. Otherwise all groups will receive every revocation broadcast intended for any one of them, causing spurious connection closures:

```ts
// ❌ Both groups listen on '__restale_control__' — revocations bleed across groups
const groupA = new SSEChannelGroup({ pubsub: adapter })
const groupB = new SSEChannelGroup({ pubsub: adapter })

// ✅ Each group has its own control channel
const groupA = new SSEChannelGroup({ pubsub: adapter, controlTopic: '__restale_control_a__' })
const groupB = new SSEChannelGroup({ pubsub: adapter, controlTopic: '__restale_control_b__' })
```

---

## `restale-kit/node` · `restale-kit/express` · `restale-kit/fastify`

`/node` and `/express` export `attachSSE` for raw Node.js `IncomingMessage`/`ServerResponse` objects. `/fastify` re-exports from `/node` but also accepts Fastify's wrapped request/reply objects directly and calls `reply.hijack()` automatically.

```ts
import { attachSSE } from 'restale-kit/node'
// or
import { attachSSE } from 'restale-kit/express'

function attachSSE<TSignal extends InvalidateSignal = InvalidateSignal>(
  req: IncomingMessage,
  res: ServerResponse,
  options: SSEChannelOptions<TSignal>
): SSEChannel<TSignal>
// Throws synchronously if the `__restale_cid__` query parameter is missing or empty.
// The returned channel's `connectionId` property is populated from the
// `__restale_cid__` query parameter extracted from the request URL.
```

```ts
import { attachSSE } from 'restale-kit/fastify'
import type { FastifyRequestLike, FastifyReplyLike } from 'restale-kit/fastify'

// Preferred: pass Fastify request/reply directly — reply.hijack() is called automatically
function attachSSE<TSignal extends InvalidateSignal = InvalidateSignal>(
  req: IncomingMessage | FastifyRequestLike,
  res: ServerResponse | FastifyReplyLike,
  options: SSEChannelOptions<TSignal>
): SSEChannel<TSignal>

interface FastifyRequestLike {
  raw: IncomingMessage
}

interface FastifyReplyLike {
  raw: ServerResponse
  hijack?: () => void
}
```

> **Fastify auto-hijack:** When a `FastifyReplyLike` object (one with a `.raw` property) is passed as `res`, `attachSSE` automatically calls `reply.hijack()` before taking ownership of the socket. You do not need to call it yourself. Passing `request.raw` / `reply.raw` directly also works, but then you must call `reply.hijack()` manually before `attachSSE`.

---

## `restale-kit/fetch` · `restale-kit/hono`

Both export the same `toSSEResponse` function (Hono re-exports from `/fetch`).

```ts
import { toSSEResponse } from 'restale-kit/fetch'
// or
import { toSSEResponse } from 'restale-kit/hono'

function toSSEResponse<TSignal extends InvalidateSignal = InvalidateSignal>(
  request: Request,
  options: SSEChannelOptions<TSignal>
): { response: Response; channel: SSEChannel<TSignal> }
// Throws synchronously if the `__restale_cid__` query parameter is missing or empty.
// `channel.connectionId` is populated from the `__restale_cid__` query parameter.
```

---

## `restale-kit/client`

```ts
import { SSEInvalidatorClient } from 'restale-kit/client'
import type { ClientOptions, ReconnectOptions, ConnectionStatus, SSEInvalidatorClientEventMap, RevokeEventDetail } from 'restale-kit/client'
import type { InvalidateSignal } from 'restale-kit/client' // re-exported for convenience
```

### `SSEInvalidatorClient`

```ts
class SSEInvalidatorClient<TSignal extends InvalidateSignal = InvalidateSignal>
  extends EventTarget
{
  constructor(url: string, options?: ClientOptions<TSignal>)
  get connectionId(): string
  get endpointUrl(): string      // the URL passed to the constructor (without __restale_cid__)
  get status(): ConnectionStatus
  get lastEventId(): string | null
  connect(): Promise<void>
  close(): void                  // closes with reason 'manual'
  closeWithUnmount(): void       // closes with reason 'unmount'; used by the React hook on unmount

  addEventListener<K extends keyof SSEInvalidatorClientEventMap<TSignal>>(
    type: K,
    listener: (ev: SSEInvalidatorClientEventMap<TSignal>[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  // standard removeEventListener overloads also available
}

interface ClientOptions<TSignal> {
  autoReconnect?: boolean | AutoReconnectOptions // default true (or { native?: boolean, jsBackoff?: boolean })
  withCredentials?: boolean         // default false
  reconnect?: ReconnectOptions
  signalSchema?: StandardSchemaV1<unknown, TSignal>
  target?: SignalTarget             // optional target discriminator ('tanstack-query' | 'swr' | 'rtk-query' | 'generic') expected by the client
}

interface AutoReconnectOptions {
  native?: boolean                  // default true (native EventSource auto-reconnect)
  jsBackoff?: boolean               // default true (JS exponential backoff retries)
}

interface ReconnectOptions {
  baseDelayMs?: number              // default 1_000
  maxDelayMs?: number               // default 30_000
  jitter?: boolean                  // default true
  maxRetries?: number               // default Infinity
}

type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
  | { status: 'error'; error: Event }
// reason: 'manual'  — caller called client.close()
// reason: 'unmount' — React hook unmounted
// reason: 'revoked' — server sent a terminal revoke frame; auto-reconnect suppressed

interface SSEInvalidatorClientEventMap<TSignal> {
  invalidate: CustomEvent<TSignal | TSignal[]>
  statuschange: CustomEvent<ConnectionStatus>
  error: CustomEvent<Event>
  /** Fired when the server sends a terminal `revoke` frame. Auto-reconnect is suppressed. */
  revoke: CustomEvent<RevokeEventDetail>
}

type RevokeEventDetail =
  | {
      reason: 'unsupported-target'
      requested: string
      supported: string[]
    }
  | {
      reason: Exclude<string, 'unsupported-target'> | undefined
      requested?: never
      supported?: never
    }
```

---

## `restale-kit/react`

```ts
import { useReStale } from 'restale-kit/react'
import type { UseReStaleOptions, UseReStaleResult, ConnectionStatus, RevokeEventDetail } from 'restale-kit/react'

function useReStale<TSignal extends InvalidateSignal = InvalidateSignal>(
  url: string,
  options: UseReStaleOptions<TSignal>
): UseReStaleResult

interface UseReStaleOptions<TSignal> extends ClientOptions<TSignal> {
  disabled?: boolean                // default false
  onInvalidate: (signal: TSignal | TSignal[]) => void  // required
  /**
   * Called when the server sends a terminal `revoke` frame.
   * The connection is already closed; auto-reconnect is suppressed.
   * Branch on `detail.reason` to distinguish revocation causes:
   * - `'unsupported-target'` — server does not support the requested target (detail includes requested & supported)
   * - any other string (e.g. `'logout'`, `'banned'`) — application-level revocation
   */
  onRevoke?: (detail: RevokeEventDetail) => void
}
// Option stability: autoReconnect, reconnect, signalSchema, and withCredentials are
// applied only at client creation time. Changing them after mount has no effect until
// the url prop changes (which recreates the SSEInvalidatorClient).

interface UseReStaleResult {
  connectionId: string
  connection: ConnectionStatus
  reconnect(): Promise<void>
  close(): void
}
```

---

## `restale-kit/tanstack-query`

```ts
import { tanstackAdapter } from 'restale-kit/tanstack-query'
import type { QueryClient } from '@tanstack/react-query'

function tanstackAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  queryClient: QueryClient
): (signal: TSignal | TSignal[]) => void

/**
 * Memoized hook variant of tanstackAdapter.
 * Call at the component top level; returns a stable callback across renders.
 * Equivalent to useCallback(tanstackAdapter(queryClient), [queryClient]).
 */
function useTanstackQueryAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  queryClient: QueryClient
): (signal: TSignal | TSignal[]) => void
```

---

## `restale-kit/swr`

```ts
import { swrAdapter } from 'restale-kit/swr'
import type { SWRAdapterOptions, SWRMutator } from 'restale-kit/swr'
import type { Arguments } from 'swr'

function swrAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  mutate: SWRMutator,
  options?: SWRAdapterOptions<TSignal>
): (signal: TSignal | TSignal[]) => void

/**
 * Memoized hook variant of swrAdapter.
 * Call at the component top level; stores options in a ref so they update on re-render
 * without breaking referential stability.
 */
function useSwrAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  mutate: SWRMutator,
  options?: SWRAdapterOptions<TSignal>
): (signal: TSignal | TSignal[]) => void

interface SWRAdapterOptions<TSignal> {
  // Convert a non-canonical SWR key to a JSONValue[] for matching.
  // Omit when SWR keys are already JSONValue[] arrays.
  toInvalidateKey?: (key: Arguments, signal: TSignal) => JSONValue[] | undefined
}

// Structural equivalent of SWR's global mutate (from useSWRConfig().mutate)
interface SWRMutator {
  (matcher: (key?: Arguments) => boolean): Promise<unknown[]>
  (matcher: (key?: Arguments) => boolean, data: undefined, revalidate: false): Promise<undefined[]>
}
```

---

## `restale-kit/pubsub`

```ts
import type { PubSubAdapter, PubSubEncryptionOptions, PubSubDecryptionError } from 'restale-kit/pubsub'
import type { PubSubMessage, JSONValue, InvalidateSignal } from 'restale-kit'

interface PubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal> {
  publish(topic: string, message: PubSubMessage<TSignal>): Promise<void>
  subscribe(
    topic: string,
    onMessage: (message: PubSubMessage<TSignal>) => void
  ): Promise<() => void | Promise<void>>
  onError?(handler: (error: unknown) => void): void
}

type PubSubEncryptionOptions =
  | { encrypt?: false; encryptionKey?: never }
  | { encrypt?: true; encryptionKey: string }

class PubSubDecryptionError extends Error {
  readonly cause?: unknown
}

```

---

## `restale-kit/redis`

```ts
import { redisPubSubAdapter } from 'restale-kit/redis'
import type { RedisClient } from 'restale-kit/redis'

// Minimal structural interface compatible with ioredis and node-redis legacy mode (event-emitter format):
interface RedisClient {
  publish(topic: string, message: string): unknown
  subscribe(topic: string): unknown
  unsubscribe(topic: string): unknown
  duplicate(): RedisClient
  on(event: 'error', listener: (err: unknown) => void): unknown
  on(event: 'message', listener: (channel: string, message: string) => void): unknown
}

function redisPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: RedisClient,
  options?: { subscribeClient?: RedisClient } & PubSubEncryptionOptions
): PubSubAdapter<TSignal>
// Pass a single client — the adapter calls client.duplicate() internally for subscriptions.
// Or pass a pre-created subscribeClient to use your own separate connection.
// Encryption is disabled by default. Pass `{ encryptionKey: string }` to enable it.

```

---

## `restale-kit/ably`

```ts
import { ablyPubSubAdapter } from 'restale-kit/ably'
import type { AblyClient, AblyChannel } from 'restale-kit/ably'

// Minimal structural interfaces compatible with the Ably SDK:
interface AblyChannel {
  publish(name: string, data: unknown): unknown
  subscribe(listener: (message: { data: unknown }) => void): unknown
  unsubscribe(listener: (message: { data: unknown }) => void): unknown
  on?(event: string, listener: (stateChange: { reason?: unknown }) => void): unknown
  off?(event: string, listener: (stateChange: { reason?: unknown }) => void): unknown
}

interface AblyClient {
  options?: { echoMessages?: boolean }
  connection?: {
    on(event: 'error', listener: (err: unknown) => void): unknown
  }
  channels: {
    get(name: string): AblyChannel
  }
}

function ablyPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: AblyClient,
  options?: { useNativeEchoSuppression?: boolean } & PubSubEncryptionOptions
): PubSubAdapter<TSignal>
// When useNativeEchoSuppression is true, the Ably client must be instantiated with
// echoMessages: false — otherwise the adapter throws at construction time.
// Encryption is disabled by default. Pass `{ encryptionKey: string }` to enable it.

```

---

## `restale-kit/pusher`

```ts
import { pusherPubSubAdapter } from 'restale-kit/pusher'
import type { PusherClient, PusherWebhook } from 'restale-kit/pusher'

// Minimal structural interfaces compatible with the pusher npm package:
interface PusherWebhook {
  isValid(): boolean
  getEvents(): Array<{ channel: string; name: string; data: string | object }>
}

interface PusherClient {
  trigger(channel: string, event: string, data: unknown): unknown
  webhook(options: { headers: Record<string, string>; rawBody: string }): PusherWebhook
}

function pusherPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  pusherServerClient: PusherClient,
  options?: PubSubEncryptionOptions
): PubSubAdapter<TSignal> & {
  // Required: call from your Pusher webhook route
  handleWebhook(rawBody: string, headers: Record<string, string>): boolean
}

```
