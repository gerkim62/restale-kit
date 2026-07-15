// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { swrAdapter, useSwrAdapter, type SWRMutator } from './adapter.js'

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

  it('invokes mutate with clear data option for remove action', () => {
    const mutate = vi.fn() as unknown as SWRMutator
    const adapter = swrAdapter(mutate)

    adapter({ key: ['todos'], action: 'remove' })

    expect(mutate).toHaveBeenCalledWith(expect.any(Function), undefined, false)
  })

  it('supports custom toInvalidateKey mapping', () => {
    const mutate = vi.fn() as unknown as SWRMutator
    const adapter = swrAdapter(mutate, {
      toInvalidateKey: (key) => (typeof key === 'string' ? [key] : undefined),
    })

    adapter({ key: ['users'] })

    const filter = (mutate as any).mock.calls[0][0]
    expect(filter('users')).toBe(true)
    expect(filter('posts')).toBe(false)
  })

  it('handles signal batches, undefined key, and non-array default key fallback', () => {
    const mutate = vi.fn() as unknown as SWRMutator
    const adapter = swrAdapter(mutate)

    adapter([{ key: ['a'] }, { key: ['b'], action: 'remove' }])
    expect(mutate).toHaveBeenCalledTimes(2)

    const filter = (mutate as any).mock.calls[0][0]
    expect(filter(undefined)).toBe(false)
    expect(filter('not-an-array')).toBe(false)
  })
})

describe('useSwrAdapter', () => {
  it('returns a stable memoized callback that delegates to swrAdapter, and updates with changed options', () => {
    const mutate = vi.fn() as unknown as SWRMutator
    const options1 = { toInvalidateKey: vi.fn().mockReturnValue(['todos']) }
    const options2 = { toInvalidateKey: vi.fn().mockReturnValue(['todos']) }

    const { result, rerender } = renderHook(
      ({ mut, opts }) => useSwrAdapter(mut, opts),
      { initialProps: { mut: mutate, opts: options1 } }
    )

    const cb1 = result.current
    cb1({ key: ['todos'] })

    expect(mutate).toHaveBeenCalledTimes(1)
    const filter = (mutate as any).mock.calls[0][0]
    filter('some-key')
    expect(options1.toInvalidateKey).toHaveBeenCalledWith('some-key', { key: ['todos'] })

    // Rerender with identical options (same reference) and check stability
    rerender({ mut: mutate, opts: options1 })
    expect(result.current).toBe(cb1)

    // Rerender with different options - callback reference remains stable (same reference)
    rerender({ mut: mutate, opts: options2 })
    expect(result.current).toBe(cb1)

    cb1({ key: ['todos'] })
    expect(mutate).toHaveBeenCalledTimes(2)
    const filter2 = (mutate as any).mock.calls[1][0]
    filter2('some-key')
    expect(options2.toInvalidateKey).toHaveBeenCalledWith('some-key', { key: ['todos'] })
    expect(options1.toInvalidateKey).toHaveBeenCalledTimes(1) // not called again
  })
})

