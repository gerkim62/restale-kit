import { describe, it, expect, vi } from 'vitest'
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
  it('returns a callback that delegates to swrAdapter', () => {
    const mutate = vi.fn() as unknown as SWRMutator
    const cb = useSwrAdapter(mutate)

    cb({ key: ['todos'] })

    expect(mutate).toHaveBeenCalledTimes(1)
    const filter = (mutate as any).mock.calls[0][0]
    expect(filter(['todos'])).toBe(true)
    expect(filter(['other'])).toBe(false)
  })
})

