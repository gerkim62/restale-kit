# API Reference

Reference for the supported `restale-kit` entry points. All subpaths are ESM-only; consult the generated declarations for exhaustive type-only exports.

---

## `restale-kit` — core types and errors

The conditional helper types used internally to correlate signals and targets are intentionally not exported. The signatures below use `SignalTarget` and similar names only as explanatory pseudotypes; consumer code should use the exported signal unions and `SIGNAL_TARGETS` values.

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
  readonly TANSTACK_QUERY: 'tanstack-query'
  readonly SWR: 'swr'
  readonly RTK: 'rtk-query'
  readonly GENERIC: 'generic'
}

interface TanStackQuerySignal {
  target?: 'tanstack-query'
  queryKey: JSONValue[]
  exact?: boolean
  type?: 'active' | 'inactive' | 'all'
  action?: 'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel'
  stale?: boolean
  inlineData?: JSONValue
}

interface SWRSignal {
  target?: 'swr'
  key: string | JSONValue[]
  action?: 'revalidate' | 'purge' | 'remove' | 'mutate'
  revalidate?: boolean
  match?: 'exact' | 'prefix'
  inlineData?: JSONValue
}

interface RTKQuerySignal {
  target?: 'rtk-query'
  tags: Array<string | { type: string; id?: string | number }>
}

interface GenericInvalidateSignal {
  target?: 'generic'
  key: JSONValue[]
  exact?: boolean
  action?: 'invalidate' | 'refetch' | 'remove'
  inlineData?: JSONValue
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

### Target & Wire Framing Behavior

- **Single-Target Channels (`target: 'swr'`)**: Callers can omit `target` when calling `invalidate()`, `publish()`, or `broadcast()`. The single target is automatically attached internally.
- **Multi-Target Channels (`target: ['swr', 'tanstack-query']`)**: Callers must pass an explicit `target` on every signal object and supply signals for all declared targets.
- **Internal Storage & PubSub**: Signals stored in `EventStore` and sent across PubSub adapters retain the `target` property (`{ target: 'swr', key: [...] }`), keeping storage and pubsub fully target-aware.
- **Wire framing**: SSE data frames retain the signal discriminator (for example, `data: {"target":"swr","key":["items"]}`). `X-ReStale-Target` communicates the negotiated connection target; it does not replace the signal discriminator.

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
  // Thrown when Standard Schema metadata validation fails
}
```

---

---

## `restale-kit/server`

```ts
import { SSEChannelGroup, createSSEChannel, createEventStore } from 'restale-kit/server'
import type { SSEChannel, SSEChannelOptions, DirectSSEChannelOptions, SSEChannelGroupOptions, ChannelSetupOptions, ChannelDefaults, FastifyRequestLike, FastifyReplyLike } from 'restale-kit/server'
import type { EventStore, EventStoreOptions, EventRecord, EventStoreResult } from 'restale-kit/server'
```

### `SSEChannelGroup(options?)`

```ts
class SSEChannelGroup<
  TSignal extends InvalidateSignal = InvalidateSignal,
  TMeta = unknown,
  TTarget extends SignalTarget | SignalTarget[] | readonly SignalTarget[] = TargetForSignal<TSignal> | readonly TargetForSignal<TSignal>[],
  TBroadcastTarget extends SignalTarget | SignalTarget[] | readonly SignalTarget[] = TTarget,
  TClientContext = unknown,
> {
  constructor(options?: {
    target?: TTarget
    metaSchema?: StandardSchemaV1<unknown, TMeta>
    clientContextSchema?: StandardSchemaV1<unknown, TClientContext>
    resolveInlineData?: ResolveInlineData<TMeta, TClientContext, TSignal>
    onInlineDataResolverError?: (info: { topic: string; missingConnectionIds: readonly string[] }) => void
    pubsub?: PubSubAdapter<TSignal>
    eventStore?: EventStore<TSignal>
    eventBufferCapacity?: number                      // capacity of a group-owned EventStore shared by channels created through this group
    controlTopic?: string                             // default '__restale_control__'
    channelDefaults?: ChannelDefaults                 // fallback channel defaults (target, lifetime, guardKeepalive, eventBufferCapacity)
  })

  readonly size: number
  readonly controlTopic: string
  readonly target?: TTarget
  readonly eventStore?: EventStore<TSignal>
  readonly channelDefaults?: ChannelDefaults

  /**
   * Creates a Web Standard Fetch API Response object, registers the channel with the group, and returns { response, channel }.
   * @framework Hono, Next.js App Router, Bun, Deno, Cloudflare Workers, Edge Runtimes
   */
  createFetchResponse(
    request: Request,
    options: ChannelSetupOptions<TSignal, TMeta, TTarget>
  ): { response: Response; channel: SSEChannel<TSignal, TTarget> }

  /**
   * Attaches an SSE channel to a Node.js HTTP response or Fastify reply, registers it with the group, and returns { channel }.
   * @framework Node.js, Express, Fastify
   */
  attachNodeResponse(
    req: IncomingMessage | FastifyRequestLike,
    res: ServerResponse | FastifyReplyLike,
    options: ChannelSetupOptions<TSignal, TMeta, TTarget>
  ): { channel: SSEChannel<TSignal, TTarget> }

  register(
    channel: SSEChannel<TSignal, TTarget>,
    ...args: undefined extends TMeta
      ? [meta?: TMeta, options?: { topics?: string[] }]
      : [meta: TMeta, options?: { topics?: string[] }]
  ): void

  deregister(channel: SSEChannel<TSignal, TTarget>): void

  broadcast(
    signal: GroupSignalInput<TSignal, TTarget>,
    predicate?: (meta: TMeta | undefined) => boolean
  ): void

  broadcastToAll(signal: GroupSignalInput<TSignal, TTarget>): void

  /** Available on single-target channel groups only. On multi-target groups, signal parameter is typed as `never`. */
  broadcastByKey(signal: [TTarget] extends [readonly SignalTarget[]] ? never : TSignal): void

  publish(topic: string, signal: GroupSignalInput<TSignal, TTarget>): Promise<void>
  pushInlineData(topic: string, payload: JSONValue): Promise<void>

  updateClientContext(
    connectionId: string,
    clientContext: TClientContext,
    options?: { scope?: TMeta extends object ? Partial<Record<keyof TMeta, JSONValue | undefined>> : Record<string, JSONValue | undefined> },
  ): Promise<{ updated: boolean }>
  getClientContext(connectionId: string): TClientContext | undefined

  revokeWhere(criteria: JSONValue): Promise<{ localClosed: number }>
  revokeByConnectionId(connectionId: string, scope?: Record<string, JSONValue>): Promise<{ closed: boolean }>
  dispose(): Promise<void>
}
```

`TBroadcastTarget` is normally inferred. When a group has no top-level `target`, but `channelDefaults.target` is configured, it preserves the channel-level override behavior while enforcing that `broadcast()`, `broadcastToAll()`, and `publish()` receive complete signal batches for those default targets.

```ts
interface InlineDataConnection<TMeta, TClientContext> {
  readonly connectionId: string
  readonly meta: TMeta | undefined
  readonly clientContext: TClientContext | undefined
}

interface InlineDataResult<TSignal extends InvalidateSignal> {
  signal: TSignal
  inlineData?: JSONValue
}

type ResolveInlineData<TMeta, TClientContext, TSignal extends InvalidateSignal> = (
  connections: ReadonlyArray<InlineDataConnection<TMeta, TClientContext>>,
  payload: JSONValue,
) => Map<string, InlineDataResult<TSignal>> | Promise<Map<string, InlineDataResult<TSignal>>>
```

`updateClientContext()` throws `SchemaValidationError` when `clientContextSchema` rejects the value. `pushInlineData()` throws for invalid topics/payloads, when no resolver is configured, or when the local resolver throws. See [Client Context & Inline Data](./inline-data.md) for behavioral details.

---

## `restale-kit/testing`

Test utility entrypoint for unit testing server-side channel group behaviors without real HTTP requests.

```ts
import { createSSEChannel } from 'restale-kit/testing'
import type { SSEChannel, DirectSSEChannelOptions } from 'restale-kit/testing'
```

### `createSSEChannel(options)`

```ts
function createSSEChannel<TSignal extends InvalidateSignal = InvalidateSignal>(
  options: DirectSSEChannelOptions
): SSEChannel<TSignal>
```

---

## `restale-kit/client`

```ts
import { SSEInvalidatorClient } from 'restale-kit/client'
import type { ClientOptions, ReconnectOptions, AutoReconnectOptions, ConnectionStatus, SSEInvalidatorClientEventMap, RejectedConnectionResponse, RevokeEventDetail, RenewEventDetail, AdaptedInvalidateCallback } from 'restale-kit/client'
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
  get attempt(): number          // current reconnect attempt (0 initially and after a successful open)
  get lastEventId(): string | null
  connect(): Promise<void>
  updateClientContext(clientContext: JSONValue): Promise<{ updated: boolean }>
  close(): void                  // closes with reason 'manual'

  addEventListener<K extends keyof SSEInvalidatorClientEventMap<TSignal>>(
    type: K,
    listener: (ev: SSEInvalidatorClientEventMap<TSignal>[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  // standard removeEventListener overloads also available
}

interface ClientOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  autoReconnect?: boolean | AutoReconnectOptions // default true (or { native?: boolean, jsBackoff?: boolean })
  withCredentials?: boolean         // default false
  reconnect?: ReconnectOptions
  target?: SignalTarget             // optional target discriminator ('tanstack-query' | 'swr' | 'rtk-query' | 'generic') expected by the client
  clientContextUrl?: string         // POST endpoint for updateClientContext; defaults to the stream URL
  debug?: boolean
  callback?: AdaptedInvalidateCallback<TargetForSignal<TSignal>, TSignal> | ((signal: TSignal | TSignal[]) => void)
  onConnect?: (event: Event) => void
  onDisconnect?: (event: Event) => void
  onError?: (error: unknown) => void
}

interface AutoReconnectOptions {
  native?: boolean                  // default true (managed mid-stream retry)
  jsBackoff?: boolean               // default true (managed setup/error backoff)
}

interface ReconnectOptions {
  baseDelayMs?: number              // default 1_000
  maxDelayMs?: number               // default 30_000
  jitter?: boolean                  // default true
  maxRetries?: number               // default Infinity
  nonRetryableStatuses?: HttpStatusMatcher | readonly HttpStatusMatcher[]
  retryAfter?: 'respect' | 'ignore'
}

type HttpStatusMatcher = number | '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | { from: number; to: number }

interface RejectedConnectionResponse {
  status: number
  headers: Readonly<Record<string, readonly string[]>>
}

type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
  | { status: 'closed'; reason: 'rejected'; response: RejectedConnectionResponse }
  | { status: 'error'; error: Event }
// reason: 'manual'  — caller called client.close()
// reason: 'unmount' — React hook unmounted
// reason: 'revoked' — server sent a terminal revoke frame; auto-reconnect suppressed

interface SSEInvalidatorClientEventMap<TSignal> {
  invalidate: CustomEvent<TSignal | TSignal[]>
  statuschange: CustomEvent<ConnectionStatus>
  error: CustomEvent<Event>
  rejected: CustomEvent<RejectedConnectionResponse>
  /** Fired when the server sends a terminal `revoke` frame. Auto-reconnect is suppressed. */
  revoke: CustomEvent<RevokeEventDetail>
  renew: CustomEvent<RenewEventDetail>
  retriesexhausted: CustomEvent<{ attempts: number; maxRetries: number }>
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
import type {
  UseReStaleOptions,
  UseReStaleResult,
  ConnectionStatus,
  RevokeEventDetail,
  RenewEventDetail,
  RejectedConnectionResponse,
  AdaptedInvalidateCallback,
} from 'restale-kit/react'

function useReStale<
  TTarget extends SignalTarget,
  TSignal extends InvalidateSignal = ReStaleSignalForTarget<TTarget>,
>(
  url: string,
  options: UseReStaleOptions<TTarget, TSignal>
): UseReStaleResult

interface UseReStaleOptions<TTarget extends SignalTarget, TSignal extends InvalidateSignal>
  extends Omit<ClientOptions<TSignal>, 'target'> {
  disabled?: boolean                // default false
  onInvalidate: AdaptedInvalidateCallback<TTarget, TSignal> // required; adapter-branded
  target?: NoInfer<TTarget>         // optional explicit target; must match the adapter brand
  /**
   * Called when the server sends a terminal `revoke` frame.
   * The connection is already closed; auto-reconnect is suppressed.
   * Branch on `detail.reason` to distinguish revocation causes:
   * - `'unsupported-target'` — server does not support the requested target (detail includes requested & supported)
   * - any other string (e.g. `'logout'`, `'banned'`) — application-level revocation
   */
  onRevoke?: (detail: RevokeEventDetail) => void
  onRejected?: (response: RejectedConnectionResponse) => void
  onRetriesExhausted?: (detail: { attempts: number; maxRetries: number }) => void
  clientContext?: JSONValue
  clientContextSync?: {
    maxAttempts?: number
    retryDelayMs?: number
    onExhausted?: 'retryOnNextChange' | 'disableUntilReconnect'
  }
}
// Runtime updates: autoReconnect, reconnect, and debug are applied to the active client.
// Identity updates: url, target, withCredentials, and clientContextUrl recreate the SSEInvalidatorClient.

interface UseReStaleResult {
  connectionId: string
  connection: ConnectionStatus
  /** Helper boolean: true if connection.status is 'open' */
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
import type { TanStackQuerySignal } from 'restale-kit'

interface QueryClientLike {
  setQueryData(queryKey: QueryKey, data: unknown): void
  invalidateQueries(filters?: unknown): unknown
  refetchQueries(filters?: unknown): unknown
  resetQueries(filters?: unknown): unknown
  removeQueries(filters?: unknown): unknown
  cancelQueries(filters?: unknown): unknown
}

function tanstackQueryAdapter<TSignal extends TanStackQuerySignal = TanStackQuerySignal>(
  queryClient: QueryClientLike,
  options?: TanstackQueryAdapterOptions,
): AdaptedInvalidateCallback<'tanstack-query', TSignal>

/**
 * Memoized hook variant of tanstackQueryAdapter.
 * Call at the component top level; returns a stable branded callback across renders.
 */
function useTanstackQueryAdapter<TSignal extends TanStackQuerySignal = TanStackQuerySignal>(
  queryClient: QueryClientLike,
  options?: TanstackQueryAdapterOptions,
): AdaptedInvalidateCallback<'tanstack-query', TSignal>

interface TanstackQueryAdapterOptions {
  markInlineDataStale?: boolean // default true
}

```

---

## `restale-kit/rtk-query`

```ts
import { rtkQueryAdapter, useRtkQueryAdapter } from 'restale-kit/rtk-query'
import type { RTKQueryApiLike, RTKQuerySignalInput } from 'restale-kit/rtk-query'

interface RTKQueryApiLike {
  util: { invalidateTags(tags: RTKQuerySignalInput['tags']): void }
}

function rtkQueryAdapter<TSignal extends RTKQuerySignalInput = RTKQuerySignalInput>(api: RTKQueryApiLike): AdaptedInvalidateCallback<'rtk-query', TSignal>
function useRtkQueryAdapter<TSignal extends RTKQuerySignalInput = RTKQuerySignalInput>(api: RTKQueryApiLike): AdaptedInvalidateCallback<'rtk-query', TSignal>
```

---

## `restale-kit/swr`

```ts
import { swrAdapter, useSwrAdapter } from 'restale-kit/swr'
import type { SWRAdapterOptions, SWRMutator } from 'restale-kit/swr'
import type { SWRSignal } from 'restale-kit'
import type { Arguments } from 'swr'

function swrAdapter<TSignal extends SWRSignal = SWRSignal>(
  mutate: SWRMutator,
  options?: SWRAdapterOptions<TSignal>
): AdaptedInvalidateCallback<'swr', TSignal>

/**
 * Memoized hook variant of swrAdapter.
 * Call at the component top level; stores options in a ref so they update on re-render
 * without breaking referential stability.
 */
function useSwrAdapter<TSignal extends SWRSignal = SWRSignal>(
  mutate: SWRMutator,
  options?: SWRAdapterOptions<TSignal>
): AdaptedInvalidateCallback<'swr', TSignal>

interface SWRAdapterOptions<TSignal> {
  // Convert a non-canonical SWR key to a JSONValue[] for matching.
  // Omit when SWR keys are already JSONValue[] arrays.
  toInvalidateKey?: (key: Arguments, signal: TSignal) => JSONValue[] | undefined
  markInlineDataStale?: boolean // default true
}

// Structural equivalent of SWR's global mutate (from useSWRConfig().mutate)
interface SWRMutator {
  (key: Arguments): Promise<unknown>
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

type PubSubMessage<TSignal extends InvalidateSignal = InvalidateSignal> =
  | { kind: 'signal'; data: TSignal | TSignal[]; id?: string }
  | { kind: 'control'; data: JSONValue }
  | { kind: 'inlineData'; topic: string; payload: JSONValue }

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
