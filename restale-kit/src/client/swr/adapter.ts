import { useCallback, useMemo, useRef } from 'react'
import { makeAdaptedCallback, type AdaptedCallback } from '@/client/core/client-contracts.js'
import { isInlineDataSignal, type CacheKey, type JSONValue, type UniversalSignal } from '@/types/protocol.js'

export type SWRKey = string | readonly unknown[]

export interface SWRAdapterOptions {
  toKey?: (key: CacheKey) => SWRKey
}

export interface SWRMutator {
  (key: SWRKey): Promise<unknown>
  (matcher: (key?: SWRKey) => boolean): Promise<unknown[]>
  (key: SWRKey, data: JSONValue, options: { revalidate: false }): Promise<unknown>
}

export function swrAdapter(mutate: SWRMutator, options: SWRAdapterOptions = {}): AdaptedCallback {
  return makeAdaptedCallback((input: UniversalSignal | UniversalSignal[]) => {
    for (const signal of Array.isArray(input) ? input : [input]) {
      const swrKey = options.toKey?.(signal.key) ?? signal.key
      if (isInlineDataSignal(signal)) {
        void mutate(swrKey, signal.inlineData, { revalidate: false })
        if (signal.markStale === true) void mutate(swrKey)
        continue
      }
      void mutate((candidate: SWRKey | undefined) => matchesKey(candidate, signal.key, signal.exact === true, options.toKey))
    }
  })
}

export function useSwrAdapter(mutate: SWRMutator, options: SWRAdapterOptions = {}): AdaptedCallback {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const callback = useCallback((signal: UniversalSignal | UniversalSignal[]) => {
    swrAdapter(mutate, optionsRef.current)(signal)
  }, [mutate])
  return useMemo(() => makeAdaptedCallback(callback), [callback])
}

function matchesKey(
  candidate: SWRKey | undefined,
  signalKey: CacheKey,
  exact: boolean,
  toKey: SWRAdapterOptions['toKey'],
): boolean {
  if (candidate === undefined || candidate === null) return false
  const target = toKey?.(signalKey) ?? signalKey
  if (typeof target === 'string') {
    if (typeof candidate !== 'string') return false
    return exact ? candidate === target : candidate.startsWith(target)
  }
  if (!Array.isArray(candidate)) return false
  if (exact ? candidate.length !== target.length : candidate.length < target.length) return false
  return target.every((value, index) => JSON.stringify(candidate[index]) === JSON.stringify(value))
}
