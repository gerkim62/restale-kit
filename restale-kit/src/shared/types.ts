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

/**
 * The payload of a single SSE `invalidate` event — one signal or a batch.
 */
export type SSEInvalidateEvent = InvalidateSignal | InvalidateSignal[]

/**
 * The two states of an SSE channel's lifecycle.
 */
export type ChannelState = 'open' | 'closed'
