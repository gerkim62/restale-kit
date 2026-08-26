import type { QueryKey } from '@tanstack/react-query'
import type { InvalidationHandler } from '@/client/core/client-contracts'
import { isInlineDataSignal, type CacheKey, type Signal } from '@/types/protocol'

export interface QueryClientLike {
  setQueryData(queryKey: QueryKey, data: unknown): void
  invalidateQueries(filters?: { queryKey?: QueryKey; exact?: boolean | undefined }, options?: unknown): Promise<void>
}

export interface TanStackQueryAdapterOptions {
  toQueryKey?: (key: CacheKey) => QueryKey
}

function applySignal(
  queryClient: QueryClientLike,
  signal: Signal,
  options: TanStackQueryAdapterOptions,
): void {
  const queryKey = options.toQueryKey?.(signal.key) ?? signal.key
  if (isInlineDataSignal(signal)) {
    queryClient.setQueryData(queryKey, signal.inlineData)
    if (signal.markStale === true) void queryClient.invalidateQueries({ queryKey, exact: true })
  } else {
    void queryClient.invalidateQueries({ queryKey, exact: signal.exact })
  }
}

export function tanstackQueryAdapter(
  queryClient: QueryClientLike,
  options: TanStackQueryAdapterOptions = {},
): InvalidationHandler {
  return (input: Signal | Signal[]) => {
    for (const signal of Array.isArray(input) ? input : [input]) {
      applySignal(queryClient, signal, options)
    }
  }
}
