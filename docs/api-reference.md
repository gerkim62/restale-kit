# API Reference

Complete export surface for every `restale-kit` subpath. All subpaths are ESM-only.

---

## `restale-kit` — core types and errors

```ts
import type { JSONValue, InvalidateSignal, SSEInvalidateEvent, ChannelState } from 'restale-kit'
import { ChannelClosedError, SchemaValidationError } from 'restale-kit'
```

### Types

```ts
type JSONValue =
  | string | number | boolean | null
  | JSONValue[]
  | { [key: string]: JSONValue }

interface InvalidateSignal {
  key: JSONValue[]
  exact?: boolean                                     // default false
  action?: 'invalidate' | 'refetch' | 'remove'       // default 'invalidate'
}

type SSEInvalidateEvent = InvalidateSignal | InvalidateSignal[]

type ChannelState = 'open' | 'closed'
```

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
import { createSSEChannel, SSEChannelGroup } from 'restale-kit/server'
import type { SSEChannel, SSEChannelOptions } from 'restale-kit/server'
```

### `createSSEChannel(options?)`

```ts
function createSSEChannel<TSignal extends InvalidateSignal = InvalidateSignal>(
  options?: SSEChannelOptions<TSignal>
): SSEChannel<TSignal>

interface SSEChannelOptions<TSignal> {
  keepaliveIntervalMs?: number                        // default 30_000
  signalSchema?: StandardSchema<unknown, TSignal>
  lastEventId?: string
  eventStore?: EventStore<TSignal>
  eventBufferCapacity?: number
  idGenerator?: () => string
}

interface SSEChannel<TSignal> {
  readonly state: ChannelState
  readonly connectionId: string                       // unique connection ID from client
  readonly stream: ReadableStream<Uint8Array>
  /**
   * Enqueues a signal (or array of signals) into the SSE stream.
   *
   * Returns the SSE event ID string assigned to this frame. When an
   * `eventStore` or `eventBufferCapacity` is configured, this ID is used
   * for Last-Event-ID replay: the client echoes it back in the
   * `Last-Event-ID` header on reconnect, and `restale-kit` replays any
   * events that follow it. If neither eventBufferCapacity nor eventStore is
   * configured, the return value is an empty string and can be ignored.
   *
   * Throws `ChannelClosedError` when `state` is `'closed'`.
   * Throws `SchemaValidationError` when `signalSchema` validation fails.
   */
  invalidate(signal: TSignal | TSignal[], customId?: string): string
  close(): void                                       // server-initiated close; idempotent
  disconnect(): void                                  // called by transport on peer disconnect; idempotent
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
    metaSchema?: StandardSchema<unknown, TMeta>
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
    meta: TMeta,
    options?: { topics?: string[] }
  ): void

  deregister(channel: SSEChannel<TSignal>): void

  broadcast(
    signal: TSignal | TSignal[],
    predicate: (meta: TMeta) => boolean
  ): void

  broadcastToAll(signal: TSignal | TSignal[]): void

  broadcastByKey(signal: TSignal): void

  publish(topic: string, signal: TSignal | TSignal[]): Promise<void>

  revoke(criteria: JSONValue): Promise<{ localClosed: number }>
  revoke(connectionId: string, scope?: Partial<TMeta>): Promise<{ closed: boolean }>

  dispose(): Promise<void>
}
```

### `revoke(criteria)` security

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
  options?: SSEChannelOptions<TSignal>
): SSEChannel<TSignal>
// Throws synchronously if the `restaleKitRequestId` query parameter is missing or empty.
```

```ts
import { attachSSE } from 'restale-kit/fastify'
import type { FastifyRequestLike, FastifyReplyLike } from 'restale-kit/fastify'

// Preferred: pass Fastify request/reply directly — reply.hijack() is called automatically
function attachSSE<TSignal extends InvalidateSignal = InvalidateSignal>(
  req: IncomingMessage | FastifyRequestLike,
  res: ServerResponse | FastifyReplyLike,
  options?: SSEChannelOptions<TSignal>
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
  options?: SSEChannelOptions<TSignal>
): { response: Response; channel: SSEChannel<TSignal> }
// Throws synchronously if the `restaleKitRequestId` query parameter is missing or empty.
```

---

## `restale-kit/client`

```ts
import { SSEInvalidatorClient } from 'restale-kit/client'
import type { ClientOptions, ReconnectOptions, ConnectionStatus, SSEInvalidatorClientEventMap } from 'restale-kit/client'
import type { InvalidateSignal } from 'restale-kit/client' // re-exported for convenience
```

### `SSEInvalidatorClient`

```ts
class SSEInvalidatorClient<TSignal extends InvalidateSignal = InvalidateSignal>
  extends EventTarget
{
  constructor(url: string, options?: ClientOptions<TSignal>)
  get connectionId(): string
  get status(): ConnectionStatus
  get lastEventId(): string | null
  connect(): Promise<void>
  close(): void

  addEventListener<K extends keyof SSEInvalidatorClientEventMap<TSignal>>(
    type: K,
    listener: (ev: SSEInvalidatorClientEventMap<TSignal>[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  // standard removeEventListener overloads also available
}

interface ClientOptions<TSignal> {
  autoReconnect?: boolean           // default true
  withCredentials?: boolean         // default false
  reconnect?: ReconnectOptions
  signalSchema?: StandardSchema<unknown, TSignal>
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
  | { status: 'closed'; reason: 'manual' | 'unmount' }
  | { status: 'error'; error: Event }

interface SSEInvalidatorClientEventMap<TSignal> {
  invalidate: CustomEvent<TSignal | TSignal[]>
  statuschange: CustomEvent<ConnectionStatus>
  error: CustomEvent<Event>
}
```

---

## `restale-kit/react`

```ts
import { useReStale } from 'restale-kit/react'
import type { UseReStaleOptions, UseReStaleResult, ConnectionStatus } from 'restale-kit/react'

function useReStale<TSignal extends InvalidateSignal = InvalidateSignal>(
  url: string,
  options: UseReStaleOptions<TSignal>
): UseReStaleResult

interface UseReStaleOptions<TSignal> extends ClientOptions<TSignal> {
  disabled?: boolean                // default false
  onInvalidate: (signal: TSignal | TSignal[]) => void  // required
}

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
import type { PubSubAdapter } from 'restale-kit/pubsub'
import type { PubSubMessage, JSONValue, InvalidateSignal } from 'restale-kit'

interface PubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal> {
  publish(topic: string, message: PubSubMessage<TSignal>): Promise<void>
  subscribe(
    topic: string,
    onMessage: (message: PubSubMessage<TSignal>) => void
  ): Promise<() => void | Promise<void>>
  onError?(handler: (error: unknown) => void): void
}
```

---

## `restale-kit/redis`

```ts
import { redisPubSubAdapter } from 'restale-kit/redis'
import type Redis from 'ioredis'

function redisPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: Redis
): PubSubAdapter<TSignal>
```

---

## `restale-kit/ably`

```ts
import { ablyPubSubAdapter } from 'restale-kit/ably'
import type * as Ably from 'ably'

function ablyPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: Ably.Realtime,
  options?: { useNativeEchoSuppression?: boolean }
): PubSubAdapter<TSignal>
```

---

## `restale-kit/pusher`

```ts
import { pusherPubSubAdapter } from 'restale-kit/pusher'
import type Pusher from 'pusher'

function pusherPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: Pusher
): PubSubAdapter<TSignal> & {
  // Required: call from your Pusher webhook route
  handleWebhook(rawBody: string, headers: Record<string, string>): boolean
}
```
