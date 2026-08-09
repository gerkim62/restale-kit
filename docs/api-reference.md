# API Reference

---

## `restale-kit`

### Constants

```ts
export const SIGNAL_TARGETS: {
  readonly TANSTACK_QUERY: 'tanstack-query'
  readonly SWR: 'swr'
  readonly RTK: 'rtk-query'
  readonly GENERIC: 'generic'
}
```

### Functions

```ts
export function isJSONValue(value: unknown): value is JSONValue
export function isJSONValueArray(value: unknown): value is JSONValue[]
export function matchesInvalidateSignalKey(cacheKey: unknown, signal: ReStaleSignal): boolean
export function validateStandardSchema<T>(schema: StandardSchemaV1<T>, input: unknown): Promise<T>
```

### Classes & Error Types

```ts
export class ChannelClosedError extends Error {
  readonly name: 'ChannelClosedError'
}

export class SchemaValidationError extends Error {
  readonly name: 'SchemaValidationError'
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>
}
```

### Types & Interfaces

```ts
export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue }
export type SignalTarget = typeof SIGNAL_TARGETS[keyof typeof SIGNAL_TARGETS]

export interface TanStackQuerySignal {
  target?: typeof SIGNAL_TARGETS.TANSTACK_QUERY
  queryKey: JSONValue[]
  exact?: boolean
  type?: 'active' | 'inactive' | 'all'
  action?: 'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel'
  stale?: boolean
}

export interface SWRSignal {
  target?: typeof SIGNAL_TARGETS.SWR
  key: string | JSONValue[]
  action?: 'revalidate' | 'purge' | 'remove' | 'mutate'
  revalidate?: boolean
  match?: 'exact' | 'prefix'
}

export interface RTKQuerySignal {
  target?: typeof SIGNAL_TARGETS.RTK
  tags: Array<string | { type: string; id?: string | number }>
}

export interface GenericInvalidateSignal {
  target?: typeof SIGNAL_TARGETS.GENERIC
  key: JSONValue[]
  exact?: boolean
  action?: 'invalidate' | 'refetch' | 'remove'
}

export type ReStaleSignal = TanStackQuerySignal | SWRSignal | RTKQuerySignal | GenericInvalidateSignal
export type InvalidateSignal = ReStaleSignal

export type ReStaleSignalForTarget<TTarget extends SignalTarget> =
  TTarget extends typeof SIGNAL_TARGETS.TANSTACK_QUERY ? TanStackQuerySignal :
  TTarget extends typeof SIGNAL_TARGETS.SWR ? SWRSignal :
  TTarget extends typeof SIGNAL_TARGETS.RTK ? RTKQuerySignal : GenericInvalidateSignal

export type TargetForSignal<TSignal extends InvalidateSignal> = ...
export type ExplicitSignalForTarget<TTarget extends SignalTarget> = ReStaleSignalForTarget<TTarget> & { target: TTarget }
export type SignalInputForTarget<TTarget extends SignalTarget | SignalTarget[] | readonly SignalTarget[] | undefined> = ...

export type SSEInvalidateEvent<TSignal extends InvalidateSignal = InvalidateSignal> = TSignal | TSignal[]

export interface EventRecord<TSignal extends InvalidateSignal = InvalidateSignal> {
  id: string
  signal: TSignal | TSignal[]
}

export interface EventStoreResult<TSignal extends InvalidateSignal = InvalidateSignal> {
  events: EventRecord<TSignal>[]
  stale: boolean
}

export interface EventStore<TSignal extends InvalidateSignal = InvalidateSignal> {
  readonly add: (signal: TSignal | TSignal[], customId?: string) => EventRecord<TSignal>
  readonly getEventsAfter: (lastEventId: string) => EventStoreResult<TSignal>
  readonly clear: () => void
}

export type ChannelState = 'open' | 'closed'

export type OnDeadline = 'reconnect' | 'revoke' | { maxAttempts?: number; retryDelayMs?: number }

export type LifetimeOptions =
  | { ttlMs: number; deadline?: never; onDeadline?: OnDeadline }
  | { deadline: number; ttlMs?: never; onDeadline?: OnDeadline }
  | { ttlMs?: undefined; deadline?: undefined; onDeadline?: OnDeadline }

export type FrameGuardResult =
  | { action: 'send' }
  | { action: 'skip' }
  | { action: 'close'; reason?: string }

export interface SignalFrameCtx<TSignal extends InvalidateSignal = InvalidateSignal> {
  readonly connectionId: string
  readonly requestedTarget: string | undefined
  readonly isResume: boolean
  readonly frameType: 'signal'
  readonly signal: TSignal | TSignal[]
}

export interface KeepaliveFrameCtx {
  readonly connectionId: string
  readonly requestedTarget: string | undefined
  readonly isResume: boolean
  readonly frameType: 'keepalive'
  readonly signal: undefined
}

export type FrameGuardCtx<TSignal extends InvalidateSignal = InvalidateSignal> = SignalFrameCtx<TSignal> | KeepaliveFrameCtx
export type BeforeFrameFn<TSignal extends InvalidateSignal = InvalidateSignal> = (ctx: FrameGuardCtx<TSignal>) => FrameGuardResult

export type RevokeEventDetail =
  | { reason: 'unsupported-target'; requested: string; supported: string[] }
  | { reason?: string; requested?: never; supported?: never }

export interface RenewEventDetail {
  reason: 'deadline'
  maxAttempts: number
  retryDelayMs: number
}
```

---

## `restale-kit/server`

### Classes & Constructors

```ts
export class SSEChannelGroup<
  TSignal extends InvalidateSignal = InvalidateSignal,
  TMeta = unknown,
  TTarget extends SignalTarget | SignalTarget[] | readonly SignalTarget[] = TargetForSignal<TSignal> | readonly TargetForSignal<TSignal>[],
> {
  constructor(options?: SSEChannelGroupOptions<TSignal, TMeta, TTarget>)

  readonly target?: TTarget
  readonly eventStore?: EventStore<TSignal>
  readonly controlTopic: string
  readonly channelDefaults?: ChannelDefaults

  attachNodeResponse(req: IncomingMessage | FastifyRequestLike, res: ServerResponse | FastifyReplyLike, options?: ChannelSetupOptions<TSignal, TMeta>): SSEChannel<TSignal>
  createFetchResponse(request: Request, options?: ChannelSetupOptions<TSignal, TMeta>): { response: Response; channel: SSEChannel<TSignal> }

  broadcastToAll(signal: TSignal | TSignal[], customId?: string): void
  broadcast(signal: TSignal | TSignal[], predicate: (meta: TMeta) => boolean, customId?: string): void
  broadcastByKey<K extends keyof TMeta>(key: K, value: TMeta[K], signal: TSignal | TSignal[], customId?: string): void

  publish(topic: string, signal: TSignal | TSignal[]): Promise<void>
  revokeByConnectionId(connectionId: string, reason?: string): Promise<void>
  revokeWhere(predicate: (meta: TMeta) => boolean, reason?: string): Promise<void>
  closeAll(reason?: string): Promise<void>
}
```

### Functions

```ts
export function createEventStore<TSignal extends InvalidateSignal = InvalidateSignal>(capacity?: number): EventStore<TSignal>
```

### Types & Interfaces

```ts
export interface SSEChannelGroupOptions<TSignal extends InvalidateSignal, TMeta, TTarget> {
  target?: TTarget
  metaSchema?: StandardSchemaV1<unknown, TMeta>
  pubsub?: PubSubAdapter<TSignal>
  eventStore?: EventStore<TSignal>
  eventBufferCapacity?: number
  controlTopic?: string
  channelDefaults?: ChannelDefaults
}

export type ChannelSetupOptions<TSignal extends InvalidateSignal, TMeta, TTarget> = Omit<SSEChannelOptions<TSignal>, 'target'> & {
  target?: TTarget
  topics?: string[]
} & (undefined extends TMeta ? { meta?: TMeta } : { meta: TMeta })

export interface SSEChannelOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  target?: SignalTarget | SignalTarget[] | readonly SignalTarget[]
  keepaliveIntervalMs?: number
  retryIntervalMs?: number
  lastEventId?: string
  eventStore?: EventStore<TSignal>
  eventBufferCapacity?: number
  idGenerator?: () => string
  connectionId?: string
  requestedTarget?: string
  lifetime?: LifetimeOptions
  beforeFrame?: BeforeFrameFn<TSignal>
  guardKeepalive?: boolean
}

export interface SSEChannel<TSignal extends InvalidateSignal = InvalidateSignal> {
  readonly state: ChannelState
  readonly connectionId: string
  readonly requestedTarget?: string
  invalidate(signal: TSignal | TSignal[], customId?: string): string
  revoke(reason?: string): void
  close(): void
}
```

---

## `restale-kit/client`

### Classes

```ts
export class SSEInvalidatorClient<TSignal extends InvalidateSignal = InvalidateSignal> extends EventTarget {
  constructor(url: string, opts?: ClientOptions<TSignal>)
  readonly connectionId: string
  readonly status: ConnectionStatus
  readonly attempt: number
  connect(): Promise<void>
  close(): void
  updateRuntimeOptions(opts?: Pick<ClientOptions<TSignal>, 'autoReconnect' | 'reconnect' | 'debug'>): void
}
```

### Functions

```ts
export function makeAdaptedCallback<TTarget extends SignalTarget, TSignal extends ReStaleSignalForTarget<TTarget>>(
  target: TTarget,
  fn: ((signal: TSignal) => void) | ((signals: TSignal[]) => void)
): AdaptedInvalidateCallback<TTarget, TSignal>
```

### Types & Interfaces

```ts
export type AdaptedInvalidateCallback<TTarget extends SignalTarget = SignalTarget, TSignal extends InvalidateSignal = InvalidateSignal> =
  ((signal: TSignal | TSignal[]) => void) & { readonly target: TTarget; readonly __restaleTarget: TTarget }

export type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
  | { status: 'closed'; reason: 'rejected'; response: RejectedConnectionResponse }
  | { status: 'error'; error: Event }

export interface RejectedConnectionResponse {
  status: number
  headers: Readonly<Record<string, readonly string[]>>
}

export interface ReconnectOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  jitter?: boolean
  maxRetries?: number
  nonRetryableStatuses?: HttpStatusMatcher | readonly HttpStatusMatcher[]
  retryAfter?: 'respect' | 'ignore'
}

export interface AutoReconnectOptions {
  native?: boolean
  jsBackoff?: boolean
}

export interface ClientOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  autoReconnect?: boolean | AutoReconnectOptions
  reconnect?: ReconnectOptions
  withCredentials?: boolean
  debug?: boolean
  target?: TargetForSignal<TSignal>
  onConnect?: (event: Event) => void
  onDisconnect?: (event: Event) => void
  onError?: (error: unknown) => void
}
```

---

## `restale-kit/react`

### Functions

```ts
export function useReStale<TTarget extends TargetForSignal<TSignal>, TSignal extends InvalidateSignal = ReStaleSignalForTarget<TTarget>>(
  url: string,
  opts: UseReStaleOptions<TTarget, TSignal>
): UseReStaleResult
```

### Types & Interfaces

```ts
export interface UseReStaleOptions<TTarget extends SignalTarget = SignalTarget, TSignal extends InvalidateSignal = ReStaleSignalForTarget<TTarget>> extends Omit<ClientOptions<TSignal>, 'target'> {
  disabled?: boolean
  onInvalidate: AdaptedInvalidateCallback<TTarget, TSignal>
  target?: TTarget
  onRevoke?: (detail: RevokeEventDetail) => void
  onRejected?: (response: RejectedConnectionResponse) => void
  onRetriesExhausted?: (detail: { attempts: number; maxRetries: number }) => void
}

export interface UseReStaleResult {
  connectionId: string
  connection: ConnectionStatus
  attempt: number
  isConnecting: boolean
  isConnected: boolean
  isReconnecting: boolean
  isClosed: boolean
  isError: boolean
  reconnect(): Promise<void>
  close(): void
}
```

---

## `restale-kit/tanstack-query`

```ts
export function tanstackQueryAdapter<TSignal extends TanStackQuerySignal = TanStackQuerySignal>(
  queryClient: QueryClientLike
): AdaptedInvalidateCallback<'tanstack-query', TSignal>

export function useTanstackQueryAdapter<TSignal extends TanStackQuerySignal = TanStackQuerySignal>(
  queryClient: QueryClientLike
): AdaptedInvalidateCallback<'tanstack-query', TSignal>

export interface QueryClientLike {
  invalidateQueries(filters?: unknown, options?: unknown): Promise<void>
  removeQueries(filters?: unknown, options?: unknown): void
  resetQueries(filters?: unknown, options?: unknown): Promise<void>
  cancelQueries(filters?: unknown, options?: unknown): Promise<void>
  refetchQueries(filters?: unknown, options?: unknown): Promise<void>
}
```

---

## `restale-kit/swr`

```ts
export function swrAdapter<TSignal extends SWRSignal = SWRSignal>(
  mutate: SWRMutator,
  options?: SWRAdapterOptions<TSignal>
): AdaptedInvalidateCallback<'swr', TSignal>

export function useSwrAdapter<TSignal extends SWRSignal = SWRSignal>(
  mutate: SWRMutator,
  options?: SWRAdapterOptions<TSignal>
): AdaptedInvalidateCallback<'swr', TSignal>
```

---

## `restale-kit/rtk-query`

```ts
export function rtkQueryAdapter<TSignal extends RTKQuerySignal = RTKQuerySignal>(
  dispatch: (action: unknown) => unknown,
  api: { util: { invalidateTags(tags: unknown[]): unknown } }
): AdaptedInvalidateCallback<'rtk-query', TSignal>

export function useRtkQueryAdapter<TSignal extends RTKQuerySignal = RTKQuerySignal>(
  dispatch: (action: unknown) => unknown,
  api: { util: { invalidateTags(tags: unknown[]): unknown } }
): AdaptedInvalidateCallback<'rtk-query', TSignal>
```

---

## `restale-kit/pubsub`

```ts
export interface PubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal> {
  publish(topic: string, message: PubSubMessage<TSignal>): Promise<void>
  subscribe(topic: string, onMessage: (message: PubSubMessage<TSignal>) => void): Promise<() => Promise<void>>
}
```

---

## `restale-kit/redis`

```ts
export function redisPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: unknown,
  options?: RedisPubSubOptions
): PubSubAdapter<TSignal>
```

---

## `restale-kit/ably`

```ts
export function ablyPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: unknown,
  options?: AblyPubSubOptions
): PubSubAdapter<TSignal>
```

---

## `restale-kit/pusher`

```ts
export function pusherPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: unknown,
  options?: PusherPubSubOptions
): PubSubAdapter<TSignal>
```

---

## `restale-kit/testing`

```ts
export function createSSEChannel<TSignal extends InvalidateSignal = InvalidateSignal>(
  options: SSEChannelOptions<TSignal>
): SSEChannel<TSignal>
```
