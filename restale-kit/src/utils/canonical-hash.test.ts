import { describe, it, expect } from 'vitest'
import { canonicalJsonSerialize, computeContextHash } from '@/utils/canonical-hash.js'

describe('canonicalJsonSerialize and computeContextHash', () => {
  it('serializes primitives deterministically', () => {
    expect(canonicalJsonSerialize(42)).toBe('42')
    expect(canonicalJsonSerialize('hello')).toBe('"hello"')
    expect(canonicalJsonSerialize(true)).toBe('true')
    expect(canonicalJsonSerialize(null)).toBe('null')
    expect(canonicalJsonSerialize(undefined)).toBeUndefined()
  })

  it('serializes objects with sorted keys regardless of insertion order', () => {
    const obj1 = { b: 2, a: 1, z: 26 }
    const obj2 = { a: 1, z: 26, b: 2 }
    expect(canonicalJsonSerialize(obj1)).toBe('{"a":1,"b":2,"z":26}')
    expect(canonicalJsonSerialize(obj2)).toBe('{"a":1,"b":2,"z":26}')
    expect(computeContextHash(obj1)).toBe(computeContextHash(obj2))
  })

  it('handles nested objects and arrays deterministically', () => {
    const obj1 = { filters: { status: 'active', tags: ['a', 'b'] }, page: 1 }
    const obj2 = { page: 1, filters: { tags: ['a', 'b'], status: 'active' } }
    expect(canonicalJsonSerialize(obj1)).toBe(canonicalJsonSerialize(obj2))
    expect(computeContextHash(obj1)).toBe(computeContextHash(obj2))
  })

  it('omits undefined object properties', () => {
    const obj1 = { page: 1, sort: undefined }
    const obj2 = { page: 1 }
    expect(canonicalJsonSerialize(obj1)).toBe('{"page":1}')
    expect(canonicalJsonSerialize(obj2)).toBe('{"page":1}')
    expect(computeContextHash(obj1)).toBe(computeContextHash(obj2))
  })

  it('produces distinct hashes for distinct contents', () => {
    const hash1 = computeContextHash({ page: 1 })
    const hash2 = computeContextHash({ page: 2 })
    expect(hash1).toBeDefined()
    expect(hash2).toBeDefined()
    expect(hash1).not.toBe(hash2)
  })

  it('returns undefined for undefined context', () => {
    expect(computeContextHash(undefined)).toBeUndefined()
  })
})
