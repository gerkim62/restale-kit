import type { QueryKey } from '@tanstack/react-query'
import { useCallback, useMemo, useRef } from 'react'
import { makeAdaptedCallback, type AdaptedCallback } from '@/client/core/client-contracts.js'
import { isInlineDataSignal, type CacheKey, type UniversalSignal } from '@/types/protocol.js'

export interface QueryClientLike {
  setQueryData(queryKey: QueryKey, data: unknown): void
  invalidateQueries(filters?: { queryKey?: QueryKey; exact?: boolean | undefined }, options?: unknown): Promise<void>
}

export interface TanstackQueryAdapterOptions {
  toQueryKey?: (key: CacheKey) => QueryKey
}

function applySignal(
  queryClient: QueryClientLike,
  signal: UniversalSignal,
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
): AdaptedCallback {
  return makeAdaptedCallback((input: UniversalSignal | UniversalSignal[]) => {
    for (const signal of Array.isArray(input) ? input : [input]) {
      applySignal(queryClient, signal, options)
    }
  })
}

export function useTanstackQueryAdapter(
  queryClient: QueryClientLike,
  options: TanstackQueryAdapterOptions = {},
): AdaptedCallback {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const callback = useCallback((signal: UniversalSignal | UniversalSignal[]) => {
    for (const s of Array.isArray(signal) ? signal : [signal]) {
      applySignal(queryClient, s, optionsRef.current)
    }
  }, [queryClient])
  return useMemo(() => makeAdaptedCallback(callback), [callback])
}
