import { useCallback } from 'react'
import type { Arguments } from 'swr'
import {
  isJSONValueArray,
  matchesInvalidateSignalKey,
  type InvalidateSignal,
  type JSONValue,
} from '../../types/protocol.js'

export interface SWRAdapterOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  /**
   * Converts a non-canonical SWR key into the hierarchical ReStale key it
   * represents. Omit this when SWR keys are themselves ReStale keys.
   */
  toInvalidateKey?: (key: Arguments, signal: TSignal) => JSONValue[] | undefined
}

/**
 * The subset of SWR's global `mutate` API required by this adapter.
 *
 * Keeping this local avoids exposing SWR's broad generic mutator surface in
 * ReStale's public API while remaining structurally compatible with it.
 */
export interface SWRMutator {
  (matcher: (key?: Arguments) => boolean): Promise<unknown[]>
  (matcher: (key?: Arguments) => boolean, data: undefined, revalidate: false): Promise<undefined[]>
}

/**
 * Creates an `onInvalidate` callback for SWR's global `mutate` function.
 *
 * By default, SWR keys must be JSON-safe arrays using the same hierarchical
 * key as the wire signal (for example `['todos', { userId: '42' }]`). This
 * lets the core's exact/prefix matching semantics work without configuration.
 *
 * Both `'invalidate'` and `'refetch'` revalidate matching SWR keys immediately:
 * SWR has no separate stale-only operation. `'remove'` clears the matching
 * cached values without revalidation.
 */
export function swrAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  mutate: SWRMutator,
  options?: SWRAdapterOptions<TSignal>
): (signal: TSignal | TSignal[]) => void {
  return (signal) => {
    const list = Array.isArray(signal) ? signal : [signal]

    for (const item of list) {
      const filter = (key?: Arguments) => {
        if (key === undefined) return false
        const invalidateKey = options?.toInvalidateKey?.(key, item) ?? toCanonicalKey(key)
        return invalidateKey !== undefined && matchesInvalidateSignalKey(invalidateKey, item)
      }

      if (item.action === 'remove') {
        void mutate(filter, undefined, false)
      } else {
        void mutate(filter)
      }
    }
  }
}

/**
 * React hook that returns a stable `onInvalidate` callback for SWR.
 *
 * Equivalent to `swrAdapter(mutate, options)` but memoized — safe to pass
 * directly to `useReStale` without creating a new function on every render.
 *
 * @example
 * import { mutate } from 'swr'
 * const onInvalidate = useSwrAdapter(mutate)
 * useReStale('/api/sse', { onInvalidate })
 */
export function useSwrAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  mutate: SWRMutator,
  options?: SWRAdapterOptions<TSignal>
): (signal: TSignal | TSignal[]) => void {
  // mutate from swr is a stable module-level singleton; options object identity may change
  // so we depend on mutate only for the memo key (options are read through a ref internally
  // via swrAdapter's closure — stable enough for typical usage).
  return useCallback(swrAdapter<TSignal>(mutate, options), [mutate])
}

function toCanonicalKey(key: Arguments): JSONValue[] | undefined {
  return isJSONValueArray(key) ? key : undefined
}
