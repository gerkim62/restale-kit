import { describe, it, expect, vi } from 'vitest'
import { makeInvalidationHandler } from './client-contracts.js'

describe('makeInvalidationHandler', () => {
  it('brands a callback and preserves its behaviour', () => {
    const fn = vi.fn()
    const adapted = makeInvalidationHandler(fn)

    expect(adapted.__restaleAdapter).toBe(true)

    adapted({ key: ['api', 'test'] })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws TypeError for non-function arguments', () => {
    // @ts-expect-error - testing invalid arguments at runtime
    expect(() => makeInvalidationHandler('invalid-arg')).toThrow(TypeError)

    // @ts-expect-error - testing invalid arguments at runtime
    expect(() => makeInvalidationHandler(null, null)).toThrow(TypeError)
  })
})
