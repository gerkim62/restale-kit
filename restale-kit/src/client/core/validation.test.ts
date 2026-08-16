import { describe, it, expect, vi } from 'vitest'
import { validatePayload } from './validation.js'

describe('client validatePayload', () => {

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

  it('rejects non-JSON-safe inlineData', () => {
    expect(() => validatePayload({
      key: ['todos'],
      inlineData: Infinity,
    })).toThrow('Signal "inlineData" field must be JSON-serialisable')
  })

  it('throws error when signal key array contains non-JSON-serialisable elements', () => {
    // isJSONValue false branch for function / symbol / bigint
    expect(() => validatePayload(JSON.stringify({ key: [1, null] }))).not.toThrow()

    expect(() =>
      validatePayload({
        key: [1, Symbol('bad')],
      } as any)
    ).toThrow(
      'Signal must have a "key" property that is an array of JSON-serialisable values'
    )
  })
})
