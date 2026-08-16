import { describe, expect, it } from 'vitest'
import { validatePayload } from '@/client/core/validation.js'
describe('universal signal migration', () => {
  it('accepts target-free signals and rejects retired routing fields', () => {
    expect(validatePayload({ key: ['todos'] })).toEqual({ key: ['todos'] })
    expect(validatePayload({ key: ['todos', 1], inlineData: { id: 1 } })).toEqual({
      key: ['todos', 1],
      inlineData: { id: 1 },
    })
    expect(() => validatePayload({ key: ['todos'], target: 'swr' })).toThrow()
  })
})
