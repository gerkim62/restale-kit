import { describe, it, expect, vi } from 'vitest'
import { makeAdaptedCallback } from './client-contracts.js'

describe('makeAdaptedCallback', () => {
  it('brands function when passed (target, fn)', () => {
    const fn = vi.fn()
    const adapted = makeAdaptedCallback('swr', fn)

    expect(adapted.target).toBe('swr')
    expect(adapted.__restaleTarget).toBe('swr')

    // Executing the function calls underlying fn
    adapted({ target: 'swr', key: '/api/test' } as any)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('brands function when passed (fn, target)', () => {
    const fn = vi.fn()
    const adapted = makeAdaptedCallback(fn, 'tanstack-query')

    expect(adapted.target).toBe('tanstack-query')
    expect(adapted.__restaleTarget).toBe('tanstack-query')
  })

  it('defaults target to generic when passed (fn) without target', () => {
    const fn = vi.fn()
    const adapted = makeAdaptedCallback(fn)

    expect(adapted.target).toBe('generic')
    expect(adapted.__restaleTarget).toBe('generic')
  })

  it('handles edge case non-function arguments gracefully', () => {
    // @ts-expect-error - testing invalid arguments at runtime
    const res1 = makeAdaptedCallback('invalid-arg', 'another-invalid')
    expect(res1).toBe('invalid-arg')

    // @ts-expect-error - testing invalid arguments at runtime
    const res2 = makeAdaptedCallback(null, null)
    expect(res2).toBeNull()
  })
})
