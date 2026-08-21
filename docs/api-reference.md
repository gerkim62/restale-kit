# API Reference

Reference for the supported `restale-kit` entry points. All subpaths are ESM-only.

---

## `restale-kit` — core types, utilities, and errors

```ts
import type {
  JSONValue,
  CacheKey,
  RevalidateSignal,
  InlineDataSignal,
  Signal,
  PubSubMessage,
  SignalPayload,
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
  isCacheKey,
  validateStandardSchema,
  canonicalJsonSerialize,
  computeContextHash,
  sha256,
} from 'restale-kit'
```

### Signal & Protocol Types

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
}

interface InlineDataSignal {
  readonly key: CacheKey
  readonly inlineData: JSONValue
  readonly markStale?: boolean
  readonly exact?: never
}

type Signal = RevalidateSignal | InlineDataSignal
type SignalPayload = Signal | Signal[]
type ChannelState = 'open' | 'closed'

type PubSubMessage =
  | { kind: 'signal'; data: Signal | Signal[]; id?: string }
  | { kind: 'control'; data: JSONValue }
  | { kind: 'inlineData'; topic: string; payload: JSONValue }

interface EventRecord {
  id: string
  signal: Signal | Signal[]
}

interface EventStoreResult {
  events: EventRecord[]
  stale: boolean
}

interface EventStore {
  readonly add: (signal: Signal | Signal[], customId?: string) => EventRecord
  readonly getEventsAfter: (lastEventId: string) => EventStoreResult
  readonly clear: () => void
}

type OnDeadline =
  | 'reconnect'
  | 'revoke'
  | { maxAttempts?: number; retryDelayMs?: number }

type LifetimeOptions =
  | { ttlMs: number; deadline?: never; onDeadline?: OnDeadline }
  | { deadline: number; ttlMs?: never; onDeadline?: OnDeadline }

type FrameGuardResult =
  | { action: 'send' }
  | { action: 'skip' }
  | { action: 'close'; reason?: string }

interface FrameGuardCtxBase {
  readonly connectionId: string
  readonly isResume: boolean
}

interface SignalFrameCtx extends FrameGuardCtxBase {
  readonly frameType: 'signal'
  readonly signal: Signal | Signal[]
}

interface KeepaliveFrameCtx extends FrameGuardCtxBase {
  readonly frameType: 'keepalive'
  readonly signal: undefined
}

type FrameGuardCtx = SignalFrameCtx | KeepaliveFrameCtx
type BeforeFrameFn = (ctx: FrameGuardCtx) => FrameGuardResult

type RevokeEventDetail = {
  reason?:
    | 'deadline'
    | 'session-expired'
    | 'logout'
    | 'banned'
    | 'unauthorized'
    | 'custom'
    | (string & {})
}

interface RenewEventDetail {
  reason: 'deadline'
  maxAttempts: number
  retryDelayMs: number
}
```

### Standard Schema Interface

```ts
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
      options?: { libraryOptions?: Record<string, unknown> }
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>
    readonly types?: {
      readonly input: Input
      readonly output: Output
    }
  }
}

namespace StandardSchemaV1 {
  type Result<Output> = SuccessResult<Output> | FailureResult

  interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }

  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }

  interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>
  }
}
```

### Utilities & Type Guards

- `isInlineDataSignal(signal: Signal): signal is InlineDataSignal`: Narrows a signal to the `InlineDataSignal` arm.
- `isJSONValue(value: unknown): value is JSONValue`: Checks if a value is JSON-serializable.
- `isCacheKey(value: unknown): value is CacheKey`: Checks if a value is a JSON-safe cache key array.
- `validateStandardSchema<T>(value: unknown, schema: StandardSchemaV1<unknown, T>): T`: Synchronously validates input against a Standard Schema v1 object. Throws `SchemaValidationError` on validation failure or if the schema returns a Promise.
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

### `SSEChannelGroup`

```ts
class SSEChannelGroup<TMeta = unknown, TClientContext = unknown> {
  constructor(options?: SSEChannelGroupOptions<TMeta, TClientContext>)

  readonly size: number
  readonly controlTopic: string
  readonly eventStore: EventStore | undefined
  readonly channelDefaults: ChannelDefaults | undefined

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
    registrationOptions?: { topics?: string[] },
  ): void

  deregister(channel: SSEChannel): void

  broadcast(
    signal: Signal | Signal[],
    predicate?: (meta: TMeta | undefined) => boolean,
  ): void

  broadcastToAll(
    signal: Signal | Signal[],
  ): void

  broadcastByKey(
    signal: RevalidateSignal,
  ): void

  publish(
    topic: string,
    signal: Signal | Signal[],
  ): Promise<void>

  pushInlineData(
    topic: string,
    payload: JSONValue,
  ): Promise<void>

  updateClientContext(
    connectionId: string,
    clientContext: TClientContext,
    options?: {
      scope?: Record<string, JSONValue | undefined>
      revision?: number
    },
  ): Promise<{ updated: boolean }>

  getClientContext(connectionId: string): TClientContext | undefined

  revokeWhere(criteria: JSONValue): Promise<{ localClosed: number }>
  revokeByConnectionId(
    connectionId: string,
    scope?: Record<string, JSONValue | undefined>,
  ): Promise<{ closed: boolean }>

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

type ChannelSetupOptions<TMeta = unknown> = SSEChannelOptions & {
  topics?: string[]
  meta?: TMeta
}

interface ChannelDefaults {
  lifetime?: LifetimeOptions
  guardKeepalive?: boolean
  eventBufferCapacity?: number
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

interface FastifyRequestLike {
  raw: IncomingMessage
}

interface FastifyReplyLike {
  raw: ServerResponse
  hijack?: () => void
}
```

### `createSSEChannel` & `SSEChannel`

```ts
function createSSEChannel(options?: SSEChannelOptions): SSEChannel

interface SSEChannelOptions {
  keepaliveIntervalMs?: number
  retryIntervalMs?: number
  lastEventId?: string
  eventStore?: EventStore
  eventBufferCapacity?: number
  idGenerator?: () => string
  lifetime?: LifetimeOptions
  beforeFrame?: BeforeFrameFn
  guardKeepalive?: boolean
}

interface SSEChannel {
  readonly state: ChannelState
  readonly connectionId: string
  readonly stream: ReadableStream<Uint8Array>
  readonly invalidate: (signal: Signal | Signal[], customId?: string) => string
  close(): void
  disconnect(): void
  revoke(reason?: string): void
  onClose(callback: () => void): void
}
```

### `createEventStore` & `EventStore`

```ts
function createEventStore(options?: EventStoreOptions): EventStore

interface EventStoreOptions {
  capacity?: number
  idGenerator?: () => string
}
```

---

## `restale-kit/testing`

Test utility entrypoint for unit testing server-side channel behaviors directly.

```ts
import { createSSEChannel } from 'restale-kit/testing'
import type { SSEChannel, SSEChannelOptions } from 'restale-kit/testing'
```

---

## `restale-kit/client`

```ts
import { SSEClient, makeInvalidationHandler } from 'restale-kit/client'
import type {
  ClientOptions,
  ReconnectOptions,
  AutoReconnectOptions,
  ConnectionStatus,
  HttpStatusMatcher,
  SSEClientEventMap,
  RejectedConnectionResponse,
  InvalidationHandler,
  RevokeEventDetail,
  RenewEventDetail,
  Signal,
  SignalPayload,
  RevalidateSignal,
  InlineDataSignal,
  CacheKey,
} from 'restale-kit/client'
```

### `SSEClient`

```ts
class SSEClient extends EventTarget {
  constructor(url: string, options?: ClientOptions)

  get connectionId(): string | undefined
  get endpointUrl(): string
  get status(): ConnectionStatus
  get attempt(): number
  get lastEventId(): string | null

  connect(): Promise<void>
  updateClientContext(
    clientContext: unknown,
    options?: { revision?: number },
  ): Promise<{ updated: boolean }>
  close(): void

  addEventListener<K extends keyof SSEClientEventMap>(
    type: K,
    listener: (ev: SSEClientEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
}

interface ClientOptions {
  autoReconnect?: boolean | AutoReconnectOptions
  reconnect?: ReconnectOptions
  withCredentials?: boolean
  debug?: boolean
  clientContextUrl?: string
  callback?: InvalidationHandler | ((signal: Signal | Signal[]) => void)
  onConnect?: (event: Event) => void
  onDisconnect?: (event: Event) => void
  onError?: (error: unknown) => void
}

interface AutoReconnectOptions {
  native?: boolean
  jsBackoff?: boolean
}

type HttpStatusMatcher =
  | number
  | '1xx' | '2xx' | '3xx' | '4xx' | '5xx'
  | { from: number; to: number }

interface ReconnectOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  jitter?: boolean
  maxRetries?: number
  nonRetryableStatuses?: HttpStatusMatcher | readonly HttpStatusMatcher[]
  retryAfter?: 'respect' | 'ignore'
}

type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
  | { status: 'closed'; reason: 'rejected'; response: RejectedConnectionResponse }
  | { status: 'error'; error: Event }

interface RejectedConnectionResponse {
  status: number
  headers: Readonly<Record<string, readonly string[]>>
}

interface SSEClientEventMap {
  connected: CustomEvent<{ connectionId: string }>
  invalidate: CustomEvent<Signal | Signal[]>
  statuschange: CustomEvent<ConnectionStatus>
  error: CustomEvent<Event>
  rejected: CustomEvent<RejectedConnectionResponse>
  revoke: CustomEvent<RevokeEventDetail>
  renew: CustomEvent<RenewEventDetail>
  retriesexhausted: CustomEvent<{ attempts: number; maxRetries: number }>
}

type InvalidationHandler = ((signal: Signal | Signal[]) => void) & {
  readonly __restaleAdapter: true
}

function makeInvalidationHandler(
  fn: (signal: Signal | Signal[]) => void,
): InvalidationHandler
```

---

## `restale-kit/react`

```tsx
import type React from 'react'
import type { Signal } from 'restale-kit'
import type {
  AutoReconnectOptions,
  ReconnectOptions,
  ConnectionStatus,
  RevokeEventDetail,
  RenewEventDetail,
  RejectedConnectionResponse,
  InvalidationHandler,
} from 'restale-kit/client'
import { RestaleProvider, useRestale } from 'restale-kit/react'
import type {
  RestaleProviderProps,
  UseRestaleOptions,
  UseRestaleResult,
  ConnectionSnapshot,
} from 'restale-kit/react'
```

### `<RestaleProvider>`

```tsx
function RestaleProvider<
  TDefaults extends Record<string, unknown> = Record<string, unknown>,
>(props: RestaleProviderProps<TDefaults>): React.JSX.Element

type ConnectionSnapshot = ConnectionStatus & {
  readonly connectionId?: string
}

interface RestaleProviderProps<
  TDefaults extends Record<string, unknown> = Record<string, unknown>,
> {
  url: string
  onInvalidate: InvalidationHandler | ((signal: Signal | Signal[]) => void)
  disabled?: boolean
  withCredentials?: boolean
  autoReconnect?: boolean | AutoReconnectOptions
  reconnect?: ReconnectOptions
  debug?: boolean
  clientContextUrl?: string
  onRevoke?: (detail: RevokeEventDetail) => void
  onRejected?: (response: RejectedConnectionResponse) => void
  onRetriesExhausted?: (detail: { attempts: number; maxRetries: number }) => void
  onConnect?: (event: Event) => void
  onDisconnect?: (event: Event) => void
  onError?: (error: unknown) => void
  initialClientContext?: TDefaults
  clientContextSync?: {
    maxAttempts?: number
    retryDelayMs?: number
    onExhausted?: 'retryOnNextChange' | 'disableUntilReconnect'
  }
  children: React.ReactNode
}
```

### `useRestale`

```ts
function useRestale<
  TEffective = Record<string, unknown>,
>(): UseRestaleResult<TEffective>

function useRestale<
  TContext extends Record<string, unknown>,
  TEffective = TContext,
>(options: UseRestaleOptions<TContext>): UseRestaleResult<TEffective>

function useRestale(
  options?: UseRestaleOptions
): UseRestaleResult

interface UseRestaleOptions<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  clientContext?: TContext
  clientContextMode?: 'merge' | 'replace'
}

interface UseRestaleResult<TEffective = Record<string, unknown>> {
  connectionId: string
  connection: ConnectionSnapshot
  attempt: number
  isConnecting: boolean
  isConnected: boolean
  isReconnecting: boolean
  isClosed: boolean
  isError: boolean
  reconnect(): Promise<void>
  close(): void
  clientContext: TEffective
}
```

---

## `restale-kit/tanstack-query`

```ts
import { tanstackQueryAdapter } from 'restale-kit/tanstack-query'
import type { QueryClientLike, TanstackQueryAdapterOptions } from 'restale-kit/tanstack-query'
import type { InvalidationHandler, CacheKey } from 'restale-kit'
import type { QueryKey } from '@tanstack/react-query'

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
): InvalidationHandler
```

---

## `restale-kit/swr`

```ts
import { swrAdapter } from 'restale-kit/swr'
import type { SWRKey, SWRAdapterOptions, SWRMutator } from 'restale-kit/swr'
import type { InvalidationHandler, CacheKey, JSONValue } from 'restale-kit'

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
): InvalidationHandler
```

---

## `restale-kit/pubsub`

```ts
import { PubSubDecryptionError } from 'restale-kit/pubsub'
import type { PubSubAdapter, PubSubEncryptionOptions } from 'restale-kit/pubsub'
import type { PubSubMessage, Signal, JSONValue } from 'restale-kit'

interface PubSubAdapter {
  readonly publish: (topic: string, message: PubSubMessage) => Promise<void>
  readonly subscribe: (
    topic: string,
    onMessage: (message: PubSubMessage) => void,
  ) => Promise<() => void | Promise<void>>
  readonly onError?: (handler: (error: unknown) => void) => void
}

type PubSubEncryptionOptions =
  | { encrypt?: false; encryptionKey?: never }
  | { encrypt?: true; encryptionKey: string }

class PubSubDecryptionError extends Error {
  readonly name: 'PubSubDecryptionError'
}
```

---

## `restale-kit/redis`

```ts
import { redisPubSubAdapter } from 'restale-kit/redis'
import type { RedisClient } from 'restale-kit/redis'
import type { PubSubAdapter, PubSubEncryptionOptions } from 'restale-kit/pubsub'

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
import type { PubSubAdapter, PubSubEncryptionOptions } from 'restale-kit/pubsub'

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
import type { PubSubAdapter, PubSubEncryptionOptions } from 'restale-kit/pubsub'

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
  handleWebhook(body: string, headers: Record<string, string>): boolean
}
```
