import { describe, expect, it } from 'vitest'
import { isJSONValue, isJSONValueArray, isInlineDataSignal } from './protocol.js'

describe('universal protocol', () => {
  it('accepts JSON-compatible cache keys', () => {
    expect(isJSONValue(['todos', { page: 1 }])).toBe(true)
    expect(isJSONValueArray(['todos', { page: 1 }])).toBe(true)
    expect(isJSONValueArray(['todos', undefined])).toBe(false)
    expect(isJSONValue(new Date())).toBe(false)
  })

  it('distinguishes inline-data signals', () => {
    expect(isInlineDataSignal({ key: ['todos'] })).toBe(false)
    expect(isInlineDataSignal({ key: ['todos'], inlineData: { id: 1 } })).toBe(true)
  })
})
