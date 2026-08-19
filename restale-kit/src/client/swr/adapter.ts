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

function applySwrSignal(
  mutate: SWRMutator,
  signal: UniversalSignal,
  options: SWRAdapterOptions,
): void {
  const swrKey = options.toKey?.(signal.key) ?? signal.key
  if (isInlineDataSignal(signal)) {
    void mutate(swrKey, signal.inlineData, { revalidate: false })
    if (signal.markStale === true) void mutate(swrKey)
    return
  }
  void mutate((candidate: SWRKey | undefined) => matchesKey(candidate, signal.key, signal.exact === true, options.toKey))
}

export function swrAdapter(mutate: SWRMutator, options: SWRAdapterOptions = {}): AdaptedCallback {
  return makeAdaptedCallback((input: UniversalSignal | UniversalSignal[]) => {
    for (const signal of Array.isArray(input) ? input : [input]) {
      applySwrSignal(mutate, signal, options)
    }
  })
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
    // Prefix matching: "/api/user" matches "/api/user/123" but also "/api/users".
    // Use exact: true for precise matching, or provide a toKey mapper that ensures delimiter boundaries.
    return exact ? candidate === target : candidate.startsWith(target)
  }
  if (!Array.isArray(candidate)) return false
  if (exact ? candidate.length !== target.length : candidate.length < target.length) return false
  return target.every((value, index) => deepEqual(candidate[index], value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((val, index) => deepEqual(val, b[index]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
  }
  return false
}
