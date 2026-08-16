import { describe, it, expect, vi } from 'vitest'
import { makeAdaptedCallback } from './client-contracts.js'

describe('makeAdaptedCallback', () => {
  it('brands a universal callback and preserves its behaviour', () => {
    const fn = vi.fn()
    const adapted = makeAdaptedCallback(fn)

    expect(adapted.__restaleAdapter).toBe(true)

    adapted({ key: ['api', 'test'] })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws TypeError for non-function arguments', () => {
    // @ts-expect-error - testing invalid arguments at runtime
    expect(() => makeAdaptedCallback('invalid-arg')).toThrow(TypeError)

    // @ts-expect-error - testing invalid arguments at runtime
    expect(() => makeAdaptedCallback(null, null)).toThrow(TypeError)
  })
})
