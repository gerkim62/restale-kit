import { describe, it, expect, vi } from 'vitest'
import { swrAdapter, type SWRMutator } from './adapter.js'
import type { CacheKey } from '@/types/protocol.js'

function toCacheKey(key: CacheKey): string {
  const resource = key[0]
  return `cache:${typeof resource === 'string' ? resource : 'unknown'}`
}

describe('swrAdapter', () => {
  it('invokes mutate with filter function for invalidate action', () => {
    const mutate = vi.fn() as unknown as SWRMutator
    const adapter = swrAdapter(mutate)

    adapter({ key: ['todos', 1] })

    expect(mutate).toHaveBeenCalledTimes(1)
    const filter = (mutate as any).mock.calls[0][0]
    expect(filter(['todos', 1])).toBe(true)
    expect(filter(['todos', 2])).toBe(false)
  })

  it('can trust pushed inlineData without marking it stale', () => {
    const mutate = vi.fn(() => Promise.resolve()) as unknown as SWRMutator
    const adapter = swrAdapter(mutate)

    adapter({ key: ['todos'], inlineData: [{ id: 1 }] })

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(['todos'], [{ id: 1 }], { revalidate: false })
  })

  it('handles signal batches, undefined key, and non-array default key fallback', () => {
    const mutate = vi.fn() as unknown as SWRMutator
    const adapter = swrAdapter(mutate)

    adapter([{ key: ['a'] }, { key: ['b'] }])
    expect(mutate).toHaveBeenCalledTimes(2)

    const filter = (mutate as any).mock.calls[0][0]
    expect(filter(undefined)).toBe(false)
    expect(filter('not-an-array')).toBe(false)
  })

  it('matches mapped string keys for prefix and exact invalidations', () => {
    const mutate = vi.fn() as unknown as SWRMutator
    const adapter = swrAdapter(mutate, { toKey: toCacheKey })

    adapter({ key: ['todos'] })
    const prefixFilter = (mutate as any).mock.calls[0][0]
    expect(prefixFilter(['cache:todos'])).toBe(false)
    expect(prefixFilter('cache:todos:active')).toBe(true)

    adapter({ key: ['todos'], exact: true })
    const exactFilter = (mutate as any).mock.calls[1][0]
    expect(exactFilter('cache:todos')).toBe(true)
    expect(exactFilter('cache:todos:active')).toBe(false)
  })

  it('matches complex nested array and object keys with deep equality', () => {
    const mutate = vi.fn() as unknown as SWRMutator
    const adapter = swrAdapter(mutate)

    adapter({ key: ['todos', { filter: 'completed', tags: ['urgent', 'work'] }], exact: true })
    const filter = (mutate as any).mock.calls[0][0]

    // Matching key with identical nested object and array structure
    expect(
      filter(['todos', { filter: 'completed', tags: ['urgent', 'work'] }])
    ).toBe(true)

    // Matching key with object properties in different declaration order
    expect(
      filter(['todos', { tags: ['urgent', 'work'], filter: 'completed' }])
    ).toBe(true)

    // Sad path: nested object value differs
    expect(
      filter(['todos', { filter: 'active', tags: ['urgent', 'work'] }])
    ).toBe(false)

    // Sad path: nested array length differs
    expect(
      filter(['todos', { filter: 'completed', tags: ['urgent'] }])
    ).toBe(false)

    // Sad path: nested object has extra or missing keys
    expect(
      filter(['todos', { filter: 'completed' }])
    ).toBe(false)
    expect(
      filter(['todos', { filter: 'completed', tags: ['urgent', 'work'], extra: true }])
    ).toBe(false)

    // Sad path: candidate is null, undefined, or wrong type
    expect(filter(null)).toBe(false)
    expect(filter(undefined)).toBe(false)
    expect(filter(['todos', null])).toBe(false)
    expect(filter(['todos', 'not-an-object'])).toBe(false)
  })

  it('handles markStale: true for inlineData signals', () => {
    const mutate = vi.fn(() => Promise.resolve()) as unknown as SWRMutator
    const adapter = swrAdapter(mutate)

    adapter({ key: ['todos'], inlineData: [{ id: 1 }], markStale: true })

    expect(mutate).toHaveBeenCalledTimes(2)
    expect(mutate).toHaveBeenNthCalledWith(1, ['todos'], [{ id: 1 }], { revalidate: false })
    expect(mutate).toHaveBeenNthCalledWith(2, ['todos'])
  })
})

