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
}

interface SSEChannel<TSignal> {
  readonly state: ChannelState
  readonly stream: ReadableStream<Uint8Array>
  invalidate(signal: TSignal | TSignal[]): void       // throws ChannelClosedError or SchemaValidationError
  close(): void                                       // server-initiated close; idempotent
  disconnect(): void                                  // called by transport on peer disconnect; idempotent
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
  })

  readonly size: number

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

  publish(topic: string, signal: TSignal | TSignal[]): Promise<void>
}
```

---

## `restale-kit/node` · `restale-kit/express` · `restale-kit/fastify`

All three export the same `attachSSE` function (Express and Fastify re-export from `/node`).

```ts
import { attachSSE } from 'restale-kit/node'
// or
import { attachSSE } from 'restale-kit/express'
// or
import { attachSSE } from 'restale-kit/fastify'

function attachSSE<TSignal extends InvalidateSignal = InvalidateSignal>(
  req: IncomingMessage,
  res: ServerResponse,
  options?: SSEChannelOptions<TSignal>
): SSEChannel<TSignal>
```

> **Fastify:** Call `reply.hijack()` before passing `request.raw` / `reply.raw`.

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
  get status(): ConnectionStatus
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

interface PubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal> {
  publish(topic: string, signal: TSignal | TSignal[]): Promise<void>
  subscribe(
    topic: string,
    onMessage: (signal: TSignal | TSignal[]) => void
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
