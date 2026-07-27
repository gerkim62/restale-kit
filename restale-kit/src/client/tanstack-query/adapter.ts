import { useCallback } from 'react'
import type { InvalidateSignal, TanStackQuerySignal, GenericInvalidateSignal } from '@/types/protocol.js'
import type { QueryClient, QueryFilters, InvalidateQueryFilters } from '@tanstack/react-query'
import { isObject } from '@/pubsub/core/pubsub-utils.js'
import { SIGNAL_TARGETS } from '@/utils/constants.js'
import type { AdaptedInvalidateCallback } from '@/client/core/client-contracts.js'
import { makeAdaptedCallback } from '@/client/core/client-contracts.js'

function isQueryTypeFilter(val: unknown): val is QueryFilters['type'] {
  return val === 'active' || val === 'inactive' || val === 'all'
}

export type TanStackQuerySignalInput =
  | TanStackQuerySignal
export type TanStackCallbackSignal<TSignal extends InvalidateSignal> =
  | TSignal
  | TSignal[]
  | GenericInvalidateSignal
  | GenericInvalidateSignal[]
  | (Omit<TanStackQuerySignal, 'target'> & { target?: typeof SIGNAL_TARGETS.TANSTACK })
  | (Omit<TanStackQuerySignal, 'target'> & { target?: typeof SIGNAL_TARGETS.TANSTACK })[]

/**
 * Creates an `onInvalidate` callback that maps wire signals to TanStack Query
 * cache operations.
 *
 * Supports `TanStackQuerySignal` with actions: `'invalidate'`, `'refetch'`, `'reset'`, `'remove'`, `'cancel'`,
 * and filters: `queryKey`, `exact`, `type`, `stale`.
 */
export function tanstackQueryAdapter<TSignal extends InvalidateSignal = TanStackQuerySignal | GenericInvalidateSignal>(
  queryClient: QueryClient
): AdaptedInvalidateCallback<'tanstack-query', TSignal> {
  return makeAdaptedCallback(
    SIGNAL_TARGETS.TANSTACK,
    (signal: TSignal | TSignal[]) => {
      const list = Array.isArray(signal) ? signal : [signal]

      for (const s of list) {
        if (!isObject(s)) continue
        const target = s.target
        if (target !== undefined && target !== SIGNAL_TARGETS.TANSTACK && target !== SIGNAL_TARGETS.GENERIC) {
          continue
        }

        const queryKey = ('queryKey' in s && Array.isArray(s.queryKey)) ? s.queryKey : ('key' in s && Array.isArray(s.key)) ? s.key : undefined
        if (!Array.isArray(queryKey)) continue

        const exact = typeof s.exact === 'boolean' ? s.exact : undefined
        const type = isQueryTypeFilter(s.type) ? s.type : undefined
        const stale = typeof s.stale === 'boolean' ? s.stale : undefined
        const action = typeof s.action === 'string' ? s.action : 'invalidate'

        const filters: QueryFilters = { queryKey }
        if (exact !== undefined) filters.exact = exact
        if (type !== undefined) filters.type = type

        switch (action) {
          case 'remove':
            queryClient.removeQueries(filters)
            break
          case 'reset':
            void queryClient.resetQueries(filters)
            break
          case 'cancel':
            void queryClient.cancelQueries(filters)
            break
          case 'refetch':
            void queryClient.refetchQueries(filters)
            break
          case 'invalidate':
          default: {
            const invalidateFilters: InvalidateQueryFilters = { ...filters }
            if (stale !== undefined) {
              invalidateFilters.refetchType = stale ? 'none' : 'active'
            }
            void queryClient.invalidateQueries(invalidateFilters)
            break
          }
        }
      }
    }
  )
}

/**
 * React hook that returns a stable `onInvalidate` callback for TanStack Query.
 *
 * The returned callback is branded as `AdaptedInvalidateCallback<'tanstack-query'>`.
 * Pass it directly to `useReStale` as `onInvalidate` — `target` will be inferred
 * automatically and a mismatch with an explicit `target` prop is a compile error.
 *
 * @example
 * const onInvalidate = useTanstackQueryAdapter(queryClient)
 * useReStale('/api/sse', { onInvalidate }) // target inferred as 'tanstack-query'
 */
export function useTanstackQueryAdapter<TSignal extends InvalidateSignal = TanStackQuerySignal | GenericInvalidateSignal>(
  queryClient: QueryClient
): AdaptedInvalidateCallback<'tanstack-query', TSignal> {
  return makeAdaptedCallback(
    SIGNAL_TARGETS.TANSTACK,
    useCallback(tanstackQueryAdapter<TSignal>(queryClient), [queryClient])
  )
}
