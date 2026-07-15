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

/**
 * A cache-library-agnostic invalidation signal sent over the SSE wire.
 *
 * - `key`: hierarchical cache key — e.g. `["todos", { userId: 4 }]`
 * - `exact`: when true, match the key exactly; when false (default), prefix match
 * - `action`: the cache operation to perform (default `'invalidate'`)
 */
export interface InvalidateSignal {
  key: JSONValue[]
  exact?: boolean
  action?: 'invalidate' | 'refetch' | 'remove'
}

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

/**
 * Matches a cache key against the core invalidation contract.
 *
 * Non-exact signals match a key prefix and allow a signal's object fields to
 * be a subset of the cache-key object. Exact signals require structural
 * equality. This gives every cache adapter the same matching semantics.
 */
export function matchesInvalidateSignalKey(cacheKey: unknown, signal: InvalidateSignal): boolean {
  if (!isJSONValueArray(cacheKey)) return false
  if (signal.exact ? cacheKey.length !== signal.key.length : cacheKey.length < signal.key.length) return false

  return signal.key.every((part, index) => matchesJSONValue(cacheKey[index], part, signal.exact === true))
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
  | { kind: 'signal'; data: TSignal | TSignal[] }
  | { kind: 'control'; data: JSONValue }

/**
 * The payload of a single SSE `invalidate` event — one signal or a batch.
 */
export type SSEInvalidateEvent = InvalidateSignal | InvalidateSignal[]

/**
 * A recorded invalidation event with a unique sequence ID.
 */
export interface EventRecord<TSignal extends InvalidateSignal = InvalidateSignal> {
  id: string
  signal: TSignal | TSignal[]
}

/**
 * An event history store interface for storing past events and replaying missed signals.
 */
export interface EventStore<TSignal extends InvalidateSignal = InvalidateSignal> {
  add(signal: TSignal | TSignal[], customId?: string): EventRecord<TSignal>
  getEventsAfter(lastEventId: string): EventRecord<TSignal>[]
  clear(): void
}

/**
 * The two states of an SSE channel's lifecycle.
 */
export type ChannelState = 'open' | 'closed'

