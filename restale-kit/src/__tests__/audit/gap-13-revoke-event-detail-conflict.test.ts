import { describe, expect, it } from 'vitest'
import { validatePayload } from '@/client/core/validation.js'

describe('universal protocol regression', () => {
  it('accepts universal signals and rejects target-era fields', () => {
    expect(validatePayload({ key: ['todos'] })).toEqual({ key: ['todos'] })
    expect(validatePayload({ key: ['todos', 1], inlineData: { id: 1 } })).toEqual({ key: ['todos', 1], inlineData: { id: 1 } })
    expect(() => validatePayload({ key: ['todos'], target: 'swr' })).toThrow()
  })
})
