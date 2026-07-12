import type { InvalidateSignal } from '../core/types.js'
import type { QueryClient } from '@tanstack/react-query'

/**
 * Creates an `onInvalidate` callback that maps wire signals to TanStack Query
 * cache operations.
 *
 * | Wire action | TanStack Query method |
 * |---|---|
 * | `'invalidate'` (default) | `queryClient.invalidateQueries()` |
 * | `'refetch'` | `queryClient.refetchQueries()` |
 * | `'remove'` | `queryClient.removeQueries()` |
 *
 * This is the v1 adapter. Supporting a different cache library means writing
 * one function in this same shape — not a change to core or client-core.
 */
export function tanstackAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  queryClient: QueryClient
): (signal: TSignal | TSignal[]) => void {
  return (signal) => {
    const list = Array.isArray(signal) ? signal : [signal]

    for (const s of list) {
      const filters = { queryKey: s.key, exact: s.exact }

      switch (s.action) {
        case 'remove':
          queryClient.removeQueries(filters)
          break
        case 'refetch':
          void queryClient.refetchQueries(filters)
          break
        case 'invalidate':
        default:
          void queryClient.invalidateQueries(filters)
          break
      }
    }
  }
}
