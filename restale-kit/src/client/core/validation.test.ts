import { describe, it, expect } from 'vitest'
import { validatePayload } from './validation.js'

describe('client validatePayload', () => {
  it('throws error when JSON.parse fails', () => {
    expect(() => validatePayload('invalid json {')).toThrow('Failed to parse SSE payload as JSON')
  })

  it('throws error when payload is scalar or null', () => {
    expect(() => validatePayload('123')).toThrow('SSE payload must be a plain object')
    expect(() => validatePayload('null')).toThrow('SSE payload must be a plain object')
    expect(() => validatePayload('"string"')).toThrow('SSE payload must be a plain object')
  })

  it('throws error on empty signal batch array', () => {
    expect(() => validatePayload('[]')).toThrow('SSE payload array must not be empty')
  })

  it('throws error when key property is missing or not an array', () => {
    expect(() => validatePayload('{}')).toThrow('Signal must have a "key" property')
    expect(() => validatePayload('{"key": "not-an-array"}')).toThrow('Signal must have a "key" property')
  })

  it('throws error when exact field is present but not boolean', () => {
    expect(() => validatePayload('{"key": ["a"], "exact": "true"}')).toThrow(
      'Signal "exact" field must be a boolean'
    )
  })

  it('throws error when action field is invalid', () => {
    expect(() => validatePayload('{"key": ["a"], "action": "update"}')).toThrow(
      "Signal \"action\" field must be one of 'invalidate', 'refetch', 'remove'"
    )
  })

  it('normalizes single valid signal and strips unknown fields', () => {
    const raw = JSON.stringify({
      key: ['todos', 1],
      exact: true,
      action: 'refetch',
      extraField: 'should be stripped',
    })

    const validated = validatePayload(raw)
    expect(validated).toEqual({
      key: ['todos', 1],
      exact: true,
      action: 'refetch',
    })
  })

  it('normalizes array batch of valid signals', () => {
    const raw = JSON.stringify([
      { key: ['todos'] },
      { key: ['users'], action: 'remove' },
    ])

    const validated = validatePayload(raw)
    expect(validated).toEqual([
      { key: ['todos'] },
      { key: ['users'], action: 'remove' },
    ])
  })
})
