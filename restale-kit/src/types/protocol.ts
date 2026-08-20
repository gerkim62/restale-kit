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

/** A serialisable hierarchical cache key shared by every adapter. */
export type CacheKey = JSONValue[]

/** Revalidate all entries matching a key, or exactly one when `exact` is true. */
export interface RevalidateSignal {
  readonly key: CacheKey
  readonly exact?: boolean
  /** Disallowed: only inline-data signals can carry data. */
  readonly inlineData?: never
  /** Disallowed: stale marking only applies after an inline-data write. */
  readonly markStale?: never
}

/** Write data at exactly one key, optionally marking that entry stale afterwards. */
export interface InlineDataSignal {
  readonly key: CacheKey
  readonly inlineData: JSONValue
  readonly markStale?: boolean
  /** Disallowed: an inline-data write is always exact. */
  readonly exact?: never
}

/** The only invalidation signal that crosses the wire. */
export type Signal = RevalidateSignal | InlineDataSignal

/** Narrows a signal to the inline-data arm. */
export function isInlineDataSignal(signal: Signal): signal is InlineDataSignal {
  return 'inlineData' in signal
}

/** Returns whether a value can be used as a serialisable ReStale key component. */
export function isJSONValue(value: unknown): value is JSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJSONValue)
  if (typeof value !== 'object') return false
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== null && proto !== Object.prototype) return false
  return Object.values(value).every(isJSONValue)
}

/** Returns whether a value is a JSON-safe hierarchical cache key. */
export function isCacheKey(value: unknown): value is CacheKey {
  return Array.isArray(value) && value.every(isJSONValue)
}

/** Discriminated union envelope carried across pub/sub adapters. */
export type PubSubMessage =
  | { kind: 'signal'; data: Signal | Signal[]; id?: string }
  | { kind: 'control'; data: JSONValue }
  | { kind: 'inlineData'; topic: string; payload: JSONValue }

/** The payload of a single SSE `invalidate` event (a signal or batch of signals). */
export type SignalPayload = Signal | Signal[]

/** A recorded invalidation event with a unique sequence ID. */
export interface EventRecord {
  id: string
  signal: Signal | Signal[]
}

/** The result of an EventStore lookup. */
export interface EventStoreResult {
  events: EventRecord[]
  stale: boolean
}

/** An event history store interface for invalidation replay. */
export interface EventStore {
  readonly add: (signal: Signal | Signal[], customId?: string) => EventRecord
  readonly getEventsAfter: (lastEventId: string) => EventStoreResult
  readonly clear: () => void
}

/** The two states of an SSE channel's lifecycle. */
export type ChannelState = 'open' | 'closed'

export type OnDeadline =
  | 'reconnect'
  | 'revoke'
  | { maxAttempts?: number; retryDelayMs?: number }

export type LifetimeOptions =
  | { ttlMs: number; deadline?: never; onDeadline?: OnDeadline }
  | { deadline: number; ttlMs?: never; onDeadline?: OnDeadline }

export type FrameGuardResult =
  | { action: 'send' }
  | { action: 'skip' }
  | { action: 'close'; reason?: string }

interface FrameGuardCtxBase {
  readonly connectionId: string
  readonly isResume: boolean
}

export interface SignalFrameCtx extends FrameGuardCtxBase {
  readonly frameType: 'signal'
  readonly signal: Signal | Signal[]
}

export interface KeepaliveFrameCtx extends FrameGuardCtxBase {
  readonly frameType: 'keepalive'
  readonly signal: undefined
}

export type FrameGuardCtx = SignalFrameCtx | KeepaliveFrameCtx
export type BeforeFrameFn = (ctx: FrameGuardCtx) => FrameGuardResult

/** Detail carried by a terminal revoke event. */
export type RevokeEventDetail = {
  reason?:
    | 'deadline'
    | 'session-expired'
    | 'logout'
    | 'banned'
    | 'unauthorized'
    | 'custom'
    | (string & {})
}

export interface RenewEventDetail {
  reason: 'deadline'
  maxAttempts: number
  retryDelayMs: number
}
