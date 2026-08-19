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

  it('validates markStale field on inlineData signals', () => {
    // Happy paths
    expect(
      validatePayload({ key: ['todos'], inlineData: { id: 1 }, markStale: true })
    ).toEqual({ key: ['todos'], inlineData: { id: 1 }, markStale: true })

    expect(
      validatePayload({ key: ['todos'], inlineData: { id: 1 }, markStale: false })
    ).toEqual({ key: ['todos'], inlineData: { id: 1 }, markStale: false })

    // Sad paths: non-boolean markStale
    expect(() =>
      validatePayload({ key: ['todos'], inlineData: { id: 1 }, markStale: 'true' } as any)
    ).toThrow('Signal "markStale" field must be a boolean')

    expect(() =>
      validatePayload({ key: ['todos'], inlineData: { id: 1 }, markStale: 1 } as any)
    ).toThrow('Signal "markStale" field must be a boolean')

    expect(() =>
      validatePayload({ key: ['todos'], inlineData: { id: 1 }, markStale: null } as any)
    ).toThrow('Signal "markStale" field must be a boolean')
  })

  it('rejects unsupported fields on inlineData and revalidate signals', () => {
    // Inline-data signal with unsupported fields
    expect(() =>
      validatePayload({ key: ['todos'], inlineData: 123, exact: true } as any)
    ).toThrow('Inline-data signals contain unsupported fields: exact')

    expect(() =>
      validatePayload({ key: ['todos'], inlineData: 123, extraField: 'bad' } as any)
    ).toThrow('Inline-data signals contain unsupported fields: extraField')

    // Revalidate signal with unsupported fields
    expect(() =>
      validatePayload({ key: ['todos'], markStale: true } as any)
    ).toThrow('Revalidate signals contain unsupported fields: markStale')

    expect(() =>
      validatePayload({ key: ['todos'], unknownProp: 42 } as any)
    ).toThrow('Revalidate signals contain unsupported fields: unknownProp')
  })

  it('rejects malformed JSON and non-object payloads', () => {
    // Sad path: invalid JSON syntax
    expect(() => validatePayload('{ invalid json }')).toThrow('Failed to parse SSE payload as JSON')

    // Sad path: non-object values (primitives, null)
    expect(() => validatePayload(123)).toThrow('Each signal must be a plain object')
    expect(() => validatePayload(null)).toThrow('Each signal must be a plain object')
    expect(() => validatePayload('null')).toThrow('Each signal must be a plain object')
    expect(() => validatePayload('true')).toThrow('Each signal must be a plain object')
  })
})

