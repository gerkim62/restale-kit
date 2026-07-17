import { useCallback, useRef } from 'react'
import type { Arguments } from 'swr'
import {
  isJSONValueArray,
  matchesInvalidateSignalKey,
  type InvalidateSignal,
  type SWRSignal,
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
 */
export interface SWRMutator {
  (matcher: (key?: Arguments) => boolean): Promise<unknown[]>
  (matcher: (key?: Arguments) => boolean, data: undefined, revalidate: false): Promise<undefined[]>
}

/**
 * Creates an `onInvalidate` callback for SWR's global `mutate` function.
 *
 * Supports `SWRSignal` (with primitive string or tuple keys) and `GenericInvalidateSignal`.
 */
export function swrAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  mutate: SWRMutator,
  options?: SWRAdapterOptions<TSignal>
): (signal: TSignal | TSignal[]) => void {
  return (signal) => {
    const list = Array.isArray(signal) ? signal : [signal]

    for (const item of list) {
      const raw = item as unknown as Record<string, unknown>
      const action = raw.action
      const isPurge = action === 'purge' || action === 'remove'



      const filter = (key?: Arguments) => {
        if (key === undefined || key === null) return false

        if (options?.toInvalidateKey) {
          const mapped = options.toInvalidateKey(key, item)
          return mapped !== undefined && matchesInvalidateSignalKey(mapped, item)
        }

        // Native SWR string key matching
        if (typeof raw.key === 'string') {
          if (typeof key === 'string') {
            return raw.match === 'exact' ? key === raw.key : key.startsWith(raw.key)
          }
          if (Array.isArray(key) && typeof key[0] === 'string') {
            return raw.match === 'exact' ? key[0] === raw.key : key[0].startsWith(raw.key)
          }
          return false
        }

        // Tuple key matching
        const invalidateKey = toCanonicalKey(key)
        return invalidateKey !== undefined && matchesInvalidateSignalKey(invalidateKey, item)
      }

      if (isPurge) {
        void mutate(filter, undefined, false)
      } else {
        void mutate(filter)
      }
    }
  }
}

/**
 * React hook that returns a stable `onInvalidate` callback for SWR.
 */
export function useSwrAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  mutate: SWRMutator,
  options?: SWRAdapterOptions<TSignal>
): (signal: TSignal | TSignal[]) => void {
  const optionsRef = useRef(options)
  optionsRef.current = options

  return useCallback(
    (signal: TSignal | TSignal[]) => {
      swrAdapter<TSignal>(mutate, optionsRef.current)(signal)
    },
    [mutate]
  )
}

function toCanonicalKey(key: Arguments): JSONValue[] | undefined {
  return isJSONValueArray(key) ? key : undefined
}

