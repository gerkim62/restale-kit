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
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false
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


