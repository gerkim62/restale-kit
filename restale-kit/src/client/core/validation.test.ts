import { describe, it, expect, vi } from 'vitest'
import { validatePayload } from './validation.js'

describe('client validatePayload', () => {
  it('throws error and logs to console.error when JSON.parse fails', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => validatePayload('invalid json {')).toThrow('Failed to parse SSE payload as JSON')
    expect(consoleSpy).toHaveBeenCalledWith(
      '[ERROR][validatePayload] Failed to parse SSE payload as JSON',
      '\n  rawData:',
      'invalid json {',
      '\n  error:',
      expect.any(String)
    )
    consoleSpy.mockRestore()
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

  it('validates signals with nested JSON objects/arrays in key and handles array non-object elements', () => {
    const rawNested = JSON.stringify({
      key: [{ filter: 'active' }, [1, 2, 'three']],
    })
    const validated = validatePayload(rawNested)
    expect(validated).toEqual({
      key: [{ filter: 'active' }, [1, 2, 'three']],
    })

    expect(() => validatePayload('[123]')).toThrow('Each signal must be a plain object')
    expect(() => validatePayload('{"key": ["a"], "action": 123}')).toThrow(
      "Signal \"action\" field must be one of 'invalidate', 'refetch', 'remove' — got '123'"
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

  it('validates tanstack-query signal correctly', () => {
    const raw = JSON.stringify({
      target: 'tanstack-query',
      queryKey: ['todos', 1],
      exact: true,
      action: 'reset',
      type: 'active',
      stale: true,
    })
    const validated = validatePayload(raw)
    expect(validated).toEqual({
      target: 'tanstack-query',
      queryKey: ['todos', 1],
      exact: true,
      action: 'reset',
      type: 'active',
      stale: true,
    })
  })

  it('validates swr signal with string and array keys', () => {
    const rawString = JSON.stringify({
      target: 'swr',
      key: '/api/todos',
      action: 'purge',
      match: 'prefix',
    })
    expect(validatePayload(rawString)).toEqual({
      target: 'swr',
      key: '/api/todos',
      action: 'purge',
      match: 'prefix',
    })

    const rawArray = JSON.stringify({
      target: 'swr',
      key: ['todos', 1],
      action: 'revalidate',
      match: 'exact',
    })
    expect(validatePayload(rawArray)).toEqual({
      target: 'swr',
      key: ['todos', 1],
      action: 'revalidate',
      match: 'exact',
    })
  })

  it('throws error for invalid tanstack-query signal fields', () => {
    expect(() => validatePayload({ target: 'tanstack-query', queryKey: 'not-an-array' })).toThrow(
      'TanStack Query signal must have a "queryKey" property'
    )
    expect(() => validatePayload({ target: 'tanstack-query', queryKey: ['a'], exact: 'yes' })).toThrow(
      'Signal "exact" field must be a boolean'
    )
    expect(() => validatePayload({ target: 'tanstack-query', queryKey: ['a'], type: 123 })).toThrow(
      'TanStack Query signal "type" field must be a string'
    )
    expect(() => validatePayload({ target: 'tanstack-query', queryKey: ['a'], action: 'unknown' })).toThrow(
      "TanStack Query signal \"action\" field must be one of 'invalidate', 'refetch', 'reset', 'remove', 'cancel'"
    )
  })

  it('throws error for invalid swr signal fields', () => {
    expect(() => validatePayload({ target: 'swr', key: 123 })).toThrow(
      'SWR signal must have a "key" property that is a string or an array'
    )
    expect(() => validatePayload({ target: 'swr', key: '/todos', action: 'invalid' })).toThrow(
      "SWR signal \"action\" field must be one of 'revalidate', 'purge'"
    )
    expect(() => validatePayload({ target: 'swr', key: '/todos', match: 'contains' })).toThrow(
      "SWR signal \"match\" field must be 'exact' or 'prefix'"
    )
  })

  it('throws error for invalid rtk-query signal fields', () => {
    expect(() => validatePayload({ target: 'rtk-query', tags: 'not-an-array' })).toThrow(
      'RTK Query signal must have a "tags" property that is an array'
    )
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



