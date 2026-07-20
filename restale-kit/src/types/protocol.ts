import type { QueryFilters } from '@tanstack/react-query'
import { SIGNAL_TARGETS } from '@/utils/constants.js'

export { SIGNAL_TARGETS }

/**
 * A value that survives a JSON.stringify → JSON.parse round trip losslessly.
 * Intentionally excludes Date, Map, Set, class instances, functions, etc.
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue }

export const TANSTACK_QUERY_ACTIONS = ['invalidate', 'refetch', 'reset', 'remove', 'cancel'] as const
export type TanStackQueryAction = (typeof TANSTACK_QUERY_ACTIONS)[number]

/** Native TanStack Query invalidation signal payload */
export interface TanStackQuerySignal {
  target: typeof SIGNAL_TARGETS.TANSTACK
  queryKey: JSONValue[]
  exact?: QueryFilters['exact']
  type?: QueryFilters['type']
  action?: TanStackQueryAction
  stale?: boolean
}

export const SWR_ACTIONS = ['revalidate', 'purge', 'remove'] as const
export type SWRAction = (typeof SWR_ACTIONS)[number]

/** Native SWR invalidation signal payload */
export interface SWRSignal {
  target: typeof SIGNAL_TARGETS.SWR
  key: string | JSONValue[]
  action?: SWRAction
  revalidate?: boolean
  match?: 'exact' | 'prefix'
}

/** Native RTK Query invalidation signal payload */
export interface RTKQuerySignal {
  target: typeof SIGNAL_TARGETS.RTK
  tags: Array<string | { type: string; id?: string | number }>
}

export const GENERIC_ACTIONS = ['invalidate', 'refetch', 'remove'] as const
export type GenericAction = (typeof GENERIC_ACTIONS)[number]

/** Generic fallback signal for raw SSE listeners */
export interface GenericInvalidateSignal {
  target?: typeof SIGNAL_TARGETS.GENERIC
  key: JSONValue[]
  exact?: boolean
  action?: GenericAction
}

export type SignalTarget = (typeof SIGNAL_TARGETS)[keyof typeof SIGNAL_TARGETS]

export type TargetInputSignal<TTarget extends SignalTarget> =
  TTarget extends 'tanstack-query' ? Omit<TanStackQuerySignal, 'target'> & { target?: 'tanstack-query' } :
  TTarget extends 'swr' ? Omit<SWRSignal, 'target'> & { target?: 'swr' } :
  TTarget extends 'rtk-query' ? Omit<RTKQuerySignal, 'target'> & { target?: 'rtk-query' } :
  Omit<GenericInvalidateSignal, 'target'> & { target?: 'generic' }

/** Discriminated union of all supported wire signals */
export type ReStaleSignal =
  | TanStackQuerySignal
  | SWRSignal
  | RTKQuerySignal
  | GenericInvalidateSignal

/** Alias for default generic parameter bounds across channels & pubsub */
export type InvalidateSignal = ReStaleSignal

/** Returns whether a value can be used as a serializable ReStale key component. */
export function isJSONValue(value: unknown): value is JSONValue {
  if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
    return true
  }
  if (Array.isArray(value)) return value.every(isJSONValue)
  if (typeof value !== 'object') return false
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== null && proto !== Object.prototype) return false
  return Object.values(value).every(isJSONValue)
}

/** Returns whether a value is a JSON-safe hierarchical cache key. */
export function isJSONValueArray(value: unknown): value is JSONValue[] {
  return Array.isArray(value) && value.every(isJSONValue)
}

function matchKeyArray(cacheKey: JSONValue[], signalKey: JSONValue[], exact: boolean): boolean {
  if (exact ? cacheKey.length !== signalKey.length : cacheKey.length < signalKey.length) return false
  return signalKey.every((part, index) => matchesJSONValue(cacheKey[index], part, exact))
}

/**
 * Matches a cache key against an invalidation signal.
 * Supports TanStackQuerySignal (queryKey), SWRSignal (key), and Generic signals.
 */
export function matchesInvalidateSignalKey(cacheKey: unknown, signal: ReStaleSignal): boolean {
  if (typeof cacheKey === 'string') {
    if ('target' in signal && signal.target === SIGNAL_TARGETS.SWR) {
      if (typeof signal.key === 'string') {
        return signal.match === 'exact' ? cacheKey === signal.key : cacheKey.startsWith(signal.key)
      }
      return matchKeyArray([cacheKey], signal.key, signal.match === 'exact')
    }
    if ('target' in signal && signal.target === SIGNAL_TARGETS.TANSTACK) {
      return matchKeyArray([cacheKey], signal.queryKey, signal.exact === true)
    }
    return false
  }

  if (!isJSONValueArray(cacheKey)) return false

  if ('target' in signal && signal.target === SIGNAL_TARGETS.TANSTACK) {
    return matchKeyArray(cacheKey, signal.queryKey, signal.exact === true)
  }

  if ('target' in signal && signal.target === SIGNAL_TARGETS.SWR) {
    if (typeof signal.key === 'string') {
      if (typeof cacheKey[0] === 'string') {
        return signal.match === 'exact'
          ? cacheKey.length === 1 && cacheKey[0] === signal.key
          : cacheKey[0].startsWith(signal.key)
      }
      return false
    }
    return matchKeyArray(cacheKey, signal.key, signal.match === 'exact')
  }

  if ('key' in signal && Array.isArray(signal.key)) {
    return matchKeyArray(cacheKey, signal.key, signal.exact === true)
  }

  return false
}


export function matchesJSONValue(actual: JSONValue, expected: JSONValue, exact: boolean): boolean {
  if (actual === expected) return true
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') {
    return false
  }

  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return false
    if (exact ? actual.length !== expected.length : actual.length < expected.length) return false
    return expected.every((part, index) => matchesJSONValue(actual[index], part, exact))
  }

  const actualEntries = Object.entries(actual)
  const expectedEntries = Object.entries(expected)
  if (exact && actualEntries.length !== expectedEntries.length) return false
  return expectedEntries.every(([key, value]) =>
    Object.hasOwn(actual, key) && matchesJSONValue(actual[key], value, exact)
  )
}

/**
 * Discriminated union envelope carried across pub/sub adapters.
 */
export type PubSubMessage<TSignal extends InvalidateSignal = InvalidateSignal> =
  | { kind: 'signal'; data: TSignal | TSignal[]; id?: string }
  | { kind: 'control'; data: JSONValue }

/**
 * The payload of a single SSE `invalidate` event — one signal or a batch.
 */
export type SSEInvalidateEvent<TSignal extends InvalidateSignal = InvalidateSignal> = TSignal | TSignal[]

/**
 * A recorded invalidation event with a unique sequence ID.
 */
export interface EventRecord<TSignal extends InvalidateSignal = InvalidateSignal> {
  id: string
  signal: TSignal | TSignal[]
}

/**
 * The result of an `EventStore.getEventsAfter` lookup.
 */
export interface EventStoreResult<TSignal extends InvalidateSignal = InvalidateSignal> {
  events: EventRecord<TSignal>[]
  stale: boolean
}

/**
 * An event history store interface for storing past events and replaying missed signals.
 */
export interface EventStore<TSignal extends InvalidateSignal = InvalidateSignal> {
  add(signal: TSignal | TSignal[], customId?: string): EventRecord<TSignal>
  getEventsAfter(lastEventId: string): EventStoreResult<TSignal>
  clear(): void
}

/**
 * The two states of an SSE channel's lifecycle.
 */
export type ChannelState = 'open' | 'closed'

// ─── Frame Guard ─────────────────────────────────────────────────────────────

/**
 * How a channel behaves when its deadline is reached.
 *
 * - `'reconnect'` (default) — sends a `renew` frame then closes, instructing the client
 *   to make one confirmatory reconnect attempt through the real auth middleware.
 *   Equivalent to `{ maxAttempts: 1, retryDelayMs: 250 }`.
 * - `'revoke'` — sends a terminal `revoke` frame. Use when the deadline itself is
 *   authoritative (e.g. derived directly from a signed token's `exp` claim).
 * - Object form — same behaviour as `'reconnect'` but overrides the `maxAttempts` /
 *   `retryDelayMs` values placed in the `renew` frame.
 */
export type OnDeadline =
  | 'reconnect'
  | 'revoke'
  | { maxAttempts?: number; retryDelayMs?: number }

/**
 * A connection-level, always-on deadline after which the channel is closed.
 *
 * `ttlMs` and `deadline` are mutually exclusive — exactly one must be supplied.
 * `onDeadline` (default `'reconnect'`) controls what happens when the deadline fires.
 *
 * @example
 * // Relative duration from connection start
 * { ttlMs: 5 * 60 * 1000 }
 *
 * @example
 * // Absolute point in time (epoch ms) from a token's exp claim
 * { deadline: tokenPayload.exp * 1000, onDeadline: 'revoke' }
 */
export type LifetimeOptions =
  | { ttlMs: number; deadline?: never; onDeadline?: OnDeadline }
  | { deadline: number; ttlMs?: never; onDeadline?: OnDeadline }

/**
 * The three outcomes `beforeFrame` may return.
 *
 * - `send`  — frame goes out normally.
 * - `skip`  — this frame is silently dropped; connection stays open.
 * - `close` — connection is closed through the revocation path (terminal frame sent,
 *   no auto-reconnect). `reason` surfaces at the same place a `revokeWhere` reason would.
 */
export type FrameGuardResult =
  | { action: 'send' }
  | { action: 'skip' }
  | { action: 'close'; reason?: string }

/**
 * The context object passed to `beforeFrame`.
 *
 * Every field here is structurally impossible for the caller to obtain via closure alone,
 * or would require the caller to re-implement internal kit details. See spec §4.2.1.
 */
interface FrameGuardCtxBase {
  /** The `__restale_cid__` for this connection. */
  readonly connectionId: string
  /** The `__restale_target__` the client requested, if any. */
  readonly requestedTarget: string | undefined
  /** `true` when this connection started from a `Last-Event-ID` header (reconnect). */
  readonly isResume: boolean
}

export interface SignalFrameCtx<TSignal extends InvalidateSignal = InvalidateSignal>
  extends FrameGuardCtxBase {
  /** Whether the frame is a signal or a keepalive tick. */
  readonly frameType: 'signal'
  /** The signal about to be sent. */
  readonly signal: TSignal | TSignal[]
}

export interface KeepaliveFrameCtx extends FrameGuardCtxBase {
  /** Whether the frame is a signal or a keepalive tick. */
  readonly frameType: 'keepalive'
  /** `undefined` for keepalive frames. */
  readonly signal: undefined
}

export type FrameGuardCtx<TSignal extends InvalidateSignal = InvalidateSignal> =
  | SignalFrameCtx<TSignal>
  | KeepaliveFrameCtx

/**
 * Integrator-supplied guard function evaluated before each outgoing frame.
 *
 * The function receives a `FrameGuardCtx` and returns (or synchronously resolves to)
 * a `FrameGuardResult`. Async functions are NOT supported — `beforeFrame` is called on
 * the synchronous invalidation path. Errors thrown inside this function are the
 * integrator's responsibility; an unhandled throw will be treated as `{ action: 'close' }`.
 */
export type BeforeFrameFn<TSignal extends InvalidateSignal = InvalidateSignal> =
  (ctx: FrameGuardCtx<TSignal>) => FrameGuardResult

/**
 * The payload of a revoke SSE event frame.
 *
 * The `reason` field conveys why the server is revoking the connection:
 * - `'deadline'` — Frame Guard deadline reached and all confirmatory reconnect attempts exhausted
 * - `'unsupported-target'` — client requested a target not in the channel's supported set
 * - Other strings — integrator-specific reasons passed to `channel.revoke(reason)`, or undefined
 *
 * The optional `details` field carries extra context specific to each reason.
 *
 * Note: This type describes the `detail` of the `revoke` CustomEvent dispatched by the client,
 * not `ConnectionStatus.reason`. When a revoke event fires, the connection status becomes
 * `{ status: 'closed', reason: 'revoked' }`, but the event detail's `reason` field contains
 * the specific cause (e.g., 'deadline', server-supplied string).
 */
export type RevokeEventDetail =
  | { reason: 'deadline' }
  | { reason: 'unsupported-target'; details?: { requested?: string; supported?: (SignalTarget)[] } }
  | { reason: string; details?: unknown }


