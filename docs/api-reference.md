# API Reference

Reference for the supported `restale-kit` entry points. All subpaths are ESM-only.

---

## `restale-kit` — core types and errors

```ts
import type {
  JSONValue,
  CacheKey,
  RevalidateSignal,
  InlineDataSignal,
  UniversalSignal,
  ReStaleSignal,
  PubSubMessage,
  SSEInvalidateEvent,
  EventRecord,
  EventStore,
  EventStoreResult,
  ChannelState,
  LifetimeOptions,
  OnDeadline,
  FrameGuardResult,
  FrameGuardCtx,
  BeforeFrameFn,
  RevokeEventDetail,
  RenewEventDetail,
  StandardSchemaV1,
} from 'restale-kit'
import {
  ChannelClosedError,
  SchemaValidationError,
  isInlineDataSignal,
  isJSONValue,
  isJSONValueArray,
  validateStandardSchema,
  canonicalJsonSerialize,
  computeContextHash,
  sha256,
} from 'restale-kit'
```

### Signal Types

```ts
type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue }

type CacheKey = JSONValue[]

interface RevalidateSignal {
  readonly key: CacheKey
  readonly exact?: boolean
  readonly inlineData?: never
  readonly markStale?: never
  readonly contextHash?: string
}

interface InlineDataSignal {
  readonly key: CacheKey
  readonly inlineData: JSONValue
  readonly markStale?: boolean
  readonly exact?: never
  readonly contextHash?: string
}

type UniversalSignal = RevalidateSignal | InlineDataSignal
type ReStaleSignal = UniversalSignal
type SSEInvalidateEvent = UniversalSignal | UniversalSignal[]
type ChannelState = 'open' | 'closed'
```

### Utilities & Type Guards

- `isInlineDataSignal(signal: UniversalSignal): signal is InlineDataSignal`: Narrows a universal signal to the `InlineDataSignal` arm.
- `isJSONValue(value: unknown): value is JSONValue`: Checks if a value is JSON-serializable.
- `isJSONValueArray(value: unknown): value is JSONValue[]`: Checks if a value is a JSON-safe array.
- `validateStandardSchema<T>(value: unknown, schema: StandardSchemaV1<unknown, T>): T`: Synchronously validates input against a Standard Schema v1 object.
- `canonicalJsonSerialize(value: unknown): string | undefined`: Serializes a value into canonical JSON with sorted keys, returning `undefined` for `undefined` or cyclic references.
- `computeContextHash(context: unknown): Promise<string | undefined>`: Computes a deterministic SHA-256 hash for client context tracking.
- `sha256(message: string): Promise<string>`: Computes a SHA-256 hex digest using Web Crypto or Node crypto.

### Errors

```ts
class ChannelClosedError extends Error {
  readonly name: 'ChannelClosedError'
}

class SchemaValidationError extends Error {
  readonly name: 'SchemaValidationError'
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>
}
```

---

## `restale-kit/server`

```ts
import { SSEChannelGroup, createSSEChannel, createEventStore } from 'restale-kit/server'
import type {
  SSEChannel,
  SSEChannelOptions,
  SSEChannelGroupOptions,
  ChannelSetupOptions,
  InlineDataConnection,
  InlineDataResult,
  ResolveInlineData,
  FastifyRequestLike,
  FastifyReplyLike,
  EventStoreOptions,
  EventStore,
  EventRecord,
  EventStoreResult,
  ChannelDefaults,
} from 'restale-kit/server'
```

### `SSEChannelGroup(options?)`

```ts
class SSEChannelGroup<TMeta = unknown, TClientContext = unknown> {
  constructor(options?: SSEChannelGroupOptions<TMeta, TClientContext>)

  readonly size: number
  readonly controlTopic: string
  readonly eventStore?: EventStore
  readonly channelDefaults?: ChannelDefaults

  createFetchResponse(
    request: Request,
    options?: ChannelSetupOptions<TMeta>,
  ): { response: Response; channel: SSEChannel }

  attachNodeResponse(
    req: IncomingMessage | FastifyRequestLike,
    res: ServerResponse | FastifyReplyLike,
    options?: ChannelSetupOptions<TMeta>,
  ): { channel: SSEChannel }

  register(
    channel: SSEChannel,
    meta?: TMeta,
    options?: { topics?: string[] },
  ): void

  deregister(channel: SSEChannel): void

  broadcast(
    signal: UniversalSignal | UniversalSignal[],
    predicate?: (meta: TMeta | undefined) => boolean,
  ): void

  broadcastToAll(
    signal: UniversalSignal | UniversalSignal[],
  ): void

  broadcastByKey(
    signal: UniversalSignal,
  ): void

  publish(
    topic: string,
    signal: UniversalSignal | UniversalSignal[],
  ): Promise<void>
  pushInlineData(topic: string, payload: JSONValue): Promise<void>

  updateClientContext(
    connectionId: string,
    clientContext: TClientContext,
    options?: {
      scope?: TMeta extends object ? Partial<Record<keyof TMeta, JSONValue | undefined>> : Record<string, JSONValue | undefined>
      revision?: number
    },
  ): Promise<{ updated: boolean }>

  getClientContext(connectionId: string): TClientContext | undefined

  revokeWhere(criteria: JSONValue): Promise<{ localClosed: number }>
  revokeByConnectionId(connectionId: string, scope?: Record<string, JSONValue>): Promise<{ closed: boolean }>
  dispose(): Promise<void>
}

interface SSEChannelGroupOptions<TMeta = unknown, TClientContext = unknown> {
  metaSchema?: StandardSchemaV1<unknown, TMeta>
  clientContextSchema?: StandardSchemaV1<unknown, TClientContext>
  resolveInlineData?: ResolveInlineData<TMeta, TClientContext>
  onInlineDataResolverError?: (info: { topic: string; missingConnectionIds: readonly string[] }) => void
  pubsub?: PubSubAdapter
  eventStore?: EventStore
  eventBufferCapacity?: number
  controlTopic?: string
  channelDefaults?: ChannelDefaults
}

interface InlineDataConnection<TMeta, TClientContext> {
  readonly connectionId: string
  readonly meta: TMeta | undefined
  readonly clientContext: TClientContext | undefined
}

interface InlineDataResult {
  signal: RevalidateSignal
  inlineData?: JSONValue
  markStale?: boolean
}

type ResolveInlineData<TMeta, TClientContext> = (
  connections: ReadonlyArray<InlineDataConnection<TMeta, TClientContext>>,
  payload: JSONValue,
) => Map<string, InlineDataResult> | Promise<Map<string, InlineDataResult>>
```

---

## `restale-kit/testing`

Test utility entrypoint for unit testing server-side channel behaviors directly.

```ts
import { createSSEChannel } from 'restale-kit/testing'
import type { SSEChannel, SSEChannelOptions } from 'restale-kit/testing'

function createSSEChannel(options?: SSEChannelOptions): SSEChannel
```

---

## `restale-kit/client`

```ts
import { SSEInvalidatorClient, makeAdaptedCallback } from 'restale-kit/client'
import type {
  ClientOptions,
  ReconnectOptions,
  AutoReconnectOptions,
  ConnectionStatus,
  SSEInvalidatorClientEventMap,
  RejectedConnectionResponse,
  AdaptedCallback,
  RevokeEventDetail,
  RenewEventDetail,
  UniversalSignal,
  RevalidateSignal,
  InlineDataSignal,
  CacheKey,
} from 'restale-kit/client'
```

### `SSEInvalidatorClient`

```ts
class SSEInvalidatorClient extends EventTarget {
  constructor(url: string, options?: ClientOptions)
  get connectionId(): string | undefined
  get endpointUrl(): string
  get status(): ConnectionStatus
  get attempt(): number
  get lastEventId(): string | null
  connect(): Promise<void>
  updateClientContext(clientContext: unknown): Promise<{ updated: boolean }>
  close(): void

  addEventListener<K extends keyof SSEInvalidatorClientEventMap>(
    type: K,
    listener: (ev: SSEInvalidatorClientEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
}

interface ClientOptions {
  autoReconnect?: boolean | AutoReconnectOptions
  withCredentials?: boolean
  reconnect?: ReconnectOptions
  clientContextUrl?: string
  debug?: boolean
  callback?: AdaptedCallback | ((signal: UniversalSignal | UniversalSignal[]) => void)
  onConnect?: (event: Event) => void
  onDisconnect?: (event: Event) => void
  onError?: (error: unknown) => void
}

type AdaptedCallback = ((signal: UniversalSignal | UniversalSignal[]) => void) & {
  readonly __brand?: 'AdaptedCallback'
}

function makeAdaptedCallback(
  callback: (signal: UniversalSignal | UniversalSignal[]) => void,
): AdaptedCallback
```

---

## `restale-kit/react`

```ts
import { useReStale } from 'restale-kit/react'
import type {
  UseReStaleOptions,
  UseReStaleResult,
  ConnectionStatus,
  RevokeEventDetail,
  RenewEventDetail,
  RejectedConnectionResponse,
  AdaptedCallback,
} from 'restale-kit/react'

function useReStale(
  url: string,
  options: UseReStaleOptions,
): UseReStaleResult

interface UseReStaleOptions extends ClientOptions {
  disabled?: boolean
  onInvalidate: AdaptedCallback | ((signal: UniversalSignal | UniversalSignal[]) => void)
  onRevoke?: (detail: RevokeEventDetail) => void
  onRejected?: (response: RejectedConnectionResponse) => void
  onRetriesExhausted?: (detail: { attempts: number; maxRetries: number }) => void
  clientContext?: unknown
  clientContextSync?: {
    maxAttempts?: number
    retryDelayMs?: number
    onExhausted?: 'retryOnNextChange' | 'disableUntilReconnect'
  }
}

interface UseReStaleResult {
  connectionId: string
  connection: ConnectionStatus
  isConnected: boolean
  reconnect(): Promise<void>
  close(): void
  attempt: number
  isConnecting: boolean
  isReconnecting: boolean
  isClosed: boolean
  isError: boolean
}
```

---

## `restale-kit/tanstack-query`

```ts
import { tanstackQueryAdapter, useTanstackQueryAdapter } from 'restale-kit/tanstack-query'
import type { QueryClientLike, TanstackQueryAdapterOptions } from 'restale-kit/tanstack-query'
import type { AdaptedCallback } from 'restale-kit/client'

interface QueryClientLike {
  setQueryData(queryKey: QueryKey, data: unknown): void
  invalidateQueries(filters?: { queryKey?: QueryKey; exact?: boolean | undefined }, options?: unknown): Promise<void>
}

interface TanstackQueryAdapterOptions {
  toQueryKey?: (key: CacheKey) => QueryKey
}

function tanstackQueryAdapter(
  queryClient: QueryClientLike,
  options?: TanstackQueryAdapterOptions,
): AdaptedCallback

function useTanstackQueryAdapter(
  queryClient: QueryClientLike,
  options?: TanstackQueryAdapterOptions,
): AdaptedCallback
```

---

## `restale-kit/swr`

```ts
import { swrAdapter, useSwrAdapter } from 'restale-kit/swr'
import type { SWRKey, SWRAdapterOptions, SWRMutator } from 'restale-kit/swr'
import type { AdaptedCallback } from 'restale-kit/client'

type SWRKey = string | readonly unknown[]

interface SWRMutator {
  (key: SWRKey): Promise<unknown>
  (matcher: (key?: SWRKey) => boolean): Promise<unknown[]>
  (key: SWRKey, data: JSONValue, options: { revalidate: false }): Promise<unknown>
}

interface SWRAdapterOptions {
  toKey?: (key: CacheKey) => SWRKey
}

function swrAdapter(
  mutate: SWRMutator,
  options?: SWRAdapterOptions,
): AdaptedCallback

function useSwrAdapter(
  mutate: SWRMutator,
  options?: SWRAdapterOptions,
): AdaptedCallback
```

---

## `restale-kit/pubsub`

```ts
import type { PubSubAdapter, PubSubEncryptionOptions, PubSubDecryptionError } from 'restale-kit/pubsub'
import type { PubSubMessage, JSONValue } from 'restale-kit'

interface PubSubAdapter {
  publish(topic: string, message: PubSubMessage): Promise<void>
  subscribe(
    topic: string,
    onMessage: (message: PubSubMessage) => void,
  ): Promise<() => void | Promise<void>>
  onError?(handler: (error: unknown) => void): void
}

type PubSubMessage =
  | { kind: 'signal'; data: UniversalSignal | UniversalSignal[]; id?: string }
  | { kind: 'control'; data: JSONValue }
  | { kind: 'inlineData'; topic: string; payload: JSONValue }

type PubSubEncryptionOptions =
  | { encrypt?: false; encryptionKey?: never }
  | { encrypt?: true; encryptionKey: string }
```

---

## `restale-kit/redis`

```ts
import { redisPubSubAdapter } from 'restale-kit/redis'
import type { RedisClient } from 'restale-kit/redis'

interface RedisClient {
  publish(topic: string, message: string): unknown
  subscribe(topic: string): unknown
  unsubscribe(topic: string): unknown
  duplicate(): RedisClient
  on(event: 'error', listener: (err: unknown) => void): unknown
  on(event: 'message', listener: (channel: string, message: string) => void): unknown
}

function redisPubSubAdapter(
  client: RedisClient,
  options?: { subscribeClient?: RedisClient } & PubSubEncryptionOptions,
): PubSubAdapter
```

---

## `restale-kit/ably`

```ts
import { ablyPubSubAdapter } from 'restale-kit/ably'
import type { AblyClient, AblyChannel } from 'restale-kit/ably'

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

function ablyPubSubAdapter(
  client: AblyClient,
  options?: { useNativeEchoSuppression?: boolean } & PubSubEncryptionOptions,
): PubSubAdapter
```

---

## `restale-kit/pusher`

```ts
import { pusherPubSubAdapter } from 'restale-kit/pusher'
import type { PusherClient, PusherWebhook } from 'restale-kit/pusher'

interface PusherWebhook {
  isValid(): boolean
  getEvents(): Array<{ channel: string; name: string; data: string | object }>
}

interface PusherClient {
  trigger(channel: string, event: string, data: unknown): unknown
  webhook(options: { headers: Record<string, string>; rawBody: string }): PusherWebhook
}

function pusherPubSubAdapter(
  pusherServerClient: PusherClient,
  options?: PubSubEncryptionOptions,
): PubSubAdapter & {
  handleWebhook(rawBody: string, headers: Record<string, string>): boolean
}
```
