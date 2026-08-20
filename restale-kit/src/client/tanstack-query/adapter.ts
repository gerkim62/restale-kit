import type { QueryKey } from '@tanstack/react-query'
import { makeInvalidationHandler, type InvalidationHandler } from '@/client/core/client-contracts.js'
import { isInlineDataSignal, type CacheKey, type Signal } from '@/types/protocol.js'

export interface QueryClientLike {
  setQueryData(queryKey: QueryKey, data: unknown): void
  invalidateQueries(filters?: { queryKey?: QueryKey; exact?: boolean | undefined }, options?: unknown): Promise<void>
}

export interface TanstackQueryAdapterOptions {
  toQueryKey?: (key: CacheKey) => QueryKey
}

function applySignal(
  queryClient: QueryClientLike,
  signal: Signal,
  options: TanstackQueryAdapterOptions,
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
  options: TanstackQueryAdapterOptions = {},
): InvalidationHandler {
  return makeInvalidationHandler((input: Signal | Signal[]) => {
    for (const signal of Array.isArray(input) ? input : [input]) {
      applySignal(queryClient, signal, options)
    }
  })
}
