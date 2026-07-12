import type { Arguments, ScopedMutator } from 'swr'
import {
  isJSONValueArray,
  matchesInvalidateSignalKey,
  type InvalidateSignal,
  type JSONValue,
} from '../shared/types.js'

export interface SWRAdapterOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  /**
   * Converts a non-canonical SWR key into the hierarchical ReStale key it
   * represents. Omit this when SWR keys are themselves ReStale keys.
   */
  toInvalidateKey?: (key: Arguments, signal: TSignal) => JSONValue[] | undefined
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
  mutate: ScopedMutator,
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
        void mutate(filter, undefined, { revalidate: false })
      } else {
        void mutate(filter)
      }
    }
  }
}

function toCanonicalKey(key: Arguments): JSONValue[] | undefined {
  return isJSONValueArray(key) ? key : undefined
}
