// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { swrAdapter, useSwrAdapter, type SWRMutator } from './adapter.js'
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

})


describe('useSwrAdapter', () => {
  it('keeps its callback stable while using the latest key mapper', () => {
    const mutate = vi.fn(() => Promise.resolve()) as unknown as SWRMutator
    const { result, rerender } = renderHook(
      ({ options }: { options: Parameters<typeof useSwrAdapter>[1] }) => useSwrAdapter(mutate, options),
      { initialProps: { options: {} } },
    )

    const callback = result.current
    result.current({ key: ['todos'] })
    expect(mutate).toHaveBeenCalledTimes(1)

    rerender({ options: { toKey: toCacheKey } })
    expect(result.current).toBe(callback)

    result.current({ key: ['todos'], inlineData: [{ id: 1 }] })
    expect(mutate).toHaveBeenLastCalledWith('cache:todos', [{ id: 1 }], { revalidate: false })
  })
})
