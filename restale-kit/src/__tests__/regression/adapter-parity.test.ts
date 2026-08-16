import { describe, it, expect, vi } from 'vitest'
import { tanstackQueryAdapter, type QueryClientLike } from '@/client/tanstack-query/adapter.js'
import { swrAdapter, type SWRMutator, type SWRKey } from '@/client/swr/adapter.js'
import type { UniversalSignal } from '@/types/protocol.js'

describe('Cross-adapter behavioral parity', () => {
  it('exercises identical semantics across TanStack Query and SWR for the same signal batch', () => {
    const revalExact: UniversalSignal = { key: ['users', 1], exact: true }
    const revalPrefix: UniversalSignal = { key: ['posts'] }
    const inlineNoStale: UniversalSignal = {
      key: ['comments', 10],
      inlineData: { text: 'hello' },
    }
    const inlineMarkStale: UniversalSignal = {
      key: ['todos', 5],
      inlineData: { done: true },
      markStale: true,
    }

    const batch: UniversalSignal[] = [
      revalExact,
      revalPrefix,
      inlineNoStale,
      inlineMarkStale,
    ]

    // ──────────────── TanStack Query Adapter ────────────────
    const queryClient: QueryClientLike = {
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    }

    const tanstackCallback = tanstackQueryAdapter(queryClient)
    tanstackCallback(batch)

    // 1. Write path: called only for inlineData signals
    expect(queryClient.setQueryData).toHaveBeenCalledTimes(2)
    expect(queryClient.setQueryData).toHaveBeenNthCalledWith(1, ['comments', 10], { text: 'hello' })
    expect(queryClient.setQueryData).toHaveBeenNthCalledWith(2, ['todos', 5], { done: true })

    // 2. Invalidate path: called for revalidate signals + markStale follow-up
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3)
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['users', 1],
      exact: true,
    })
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['posts'],
      exact: undefined,
    })
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ['todos', 5],
      exact: true,
    })

    // ──────────────── SWR Adapter ────────────────
    const mutate = vi.fn().mockResolvedValue(undefined) as unknown as SWRMutator

    const swrCallback = swrAdapter(mutate)
    swrCallback(batch)

    // 1. Write path: called only for inlineData signals with { revalidate: false }
    const mutateCalls = (mutate as any).mock.calls as unknown[][]
    const setCalls = mutateCalls.filter((c) => c.length === 3)
    expect(setCalls).toHaveLength(2)
    expect(setCalls[0]).toEqual([['comments', 10], { text: 'hello' }, { revalidate: false }])
    expect(setCalls[1]).toEqual([['todos', 5], { done: true }, { revalidate: false }])

    // 2. Revalidate signals: called with predicate matcher functions
    const predicateCalls = mutateCalls.filter(
      (c) => c.length === 1 && typeof c[0] === 'function'
    )
    expect(predicateCalls).toHaveLength(2)

    // Matcher 1 corresponds to revalExact: exact key match ['users', 1]
    const exactMatcher = predicateCalls[0][0] as (key?: SWRKey) => boolean
    expect(exactMatcher(['users', 1])).toBe(true)
    expect(exactMatcher(['users', 1, 'extra'])).toBe(false)
    expect(exactMatcher(['users', 2])).toBe(false)
    expect(exactMatcher(undefined)).toBe(false)

    // Matcher 2 corresponds to revalPrefix: prefix key match ['posts']
    const prefixMatcher = predicateCalls[1][0] as (key?: SWRKey) => boolean
    expect(prefixMatcher(['posts'])).toBe(true)
    expect(prefixMatcher(['posts', 'recent'])).toBe(true)
    expect(prefixMatcher(['posts', 1, 'comments'])).toBe(true)
    expect(prefixMatcher(['users', 1])).toBe(false)
    expect(prefixMatcher(undefined)).toBe(false)

    // 3. MarkStale follow-up: called with key only for revalidation after write
    const keyRevalidateCalls = mutateCalls.filter(
      (c) => c.length === 1 && typeof c[0] !== 'function'
    )
    expect(keyRevalidateCalls).toHaveLength(1)
    expect(keyRevalidateCalls[0]).toEqual([['todos', 5]])
  })
})
