import { useCallback } from 'react'
import type { TanStackQuerySignal, InvalidateSignal } from '@/types/protocol.js'
import type { QueryClient, QueryFilters, InvalidateQueryFilters } from '@tanstack/react-query'

/**
 * Creates an `onInvalidate` callback that maps wire signals to TanStack Query
 * cache operations.
 *
 * Supports `TanStackQuerySignal` with actions: `'invalidate'`, `'refetch'`, `'reset'`, `'remove'`, `'cancel'`,
 * and filters: `queryKey`, `exact`, `type`, `stale`.
 */
export function tanstackQueryAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  queryClient: QueryClient
): (signal: TSignal | TSignal[]) => void {
  return (signal) => {
    const list = Array.isArray(signal) ? signal : [signal]

    for (const s of list) {
      const raw = s as unknown as Record<string, unknown>
      const queryKey = (raw.queryKey ?? raw.key) as QueryFilters['queryKey']
      if (!Array.isArray(queryKey)) continue

      const exact = (typeof raw.exact === 'boolean' ? raw.exact : undefined) as QueryFilters['exact']
      const type = (typeof raw.type === 'string' ? raw.type : undefined) as QueryFilters['type']
      const stale = typeof raw.stale === 'boolean' ? raw.stale : undefined
      const action = typeof raw.action === 'string' ? raw.action : 'invalidate'

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
}

/** Alias for tanstackQueryAdapter */
export const tanstackAdapter = tanstackQueryAdapter

/**
 * React hook that returns a stable `onInvalidate` callback for TanStack Query.
 *
 * @example
 * const onInvalidate = useTanstackQueryAdapter(queryClient)
 * useReStale('/api/sse', { onInvalidate })
 */
export function useTanstackQueryAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  queryClient: QueryClient
): (signal: TSignal | TSignal[]) => void {
  return useCallback(tanstackQueryAdapter<TSignal>(queryClient), [queryClient])
}

