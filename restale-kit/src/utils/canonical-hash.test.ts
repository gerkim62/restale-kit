import { describe, it, expect, vi } from 'vitest'
import { canonicalJsonSerialize, computeContextHash, computeSenderHash, sha256 } from '@/utils/canonical-hash.js'

describe('canonicalJsonSerialize, sha256, computeContextHash, and computeSenderHash', () => {
  it('computes valid SHA-256 for standard test vectors', async () => {
    // NIST test vectors
    expect(await sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256('message digest')).toBe('f7846f55cf23e14eebeab5b4e1550cad5b509e3348fbc4efa3a1413d393cb650')
  })

  it('computes deterministic sender hash from connection ID', async () => {
    const connId = '123e4567-e89b-12d3-a456-426614174000'
    const hash1 = await computeSenderHash(connId)
    const hash2 = await computeSenderHash(connId)
    expect(hash1).toHaveLength(64)
    expect(hash1).toBe(hash2)
    expect(hash1).toBe(await sha256(connId))
  })

  it('serializes primitives deterministically', () => {
    expect(canonicalJsonSerialize(42)).toBe('42')
    expect(canonicalJsonSerialize('hello')).toBe('"hello"')
    expect(canonicalJsonSerialize(true)).toBe('true')
    expect(canonicalJsonSerialize(null)).toBe('null')
    expect(canonicalJsonSerialize(undefined)).toBeUndefined()
  })

  it('serializes objects with sorted keys regardless of insertion order', async () => {
    const obj1 = { b: 2, a: 1, z: 26 }
    const obj2 = { a: 1, z: 26, b: 2 }
    expect(canonicalJsonSerialize(obj1)).toBe('{"a":1,"b":2,"z":26}')
    expect(canonicalJsonSerialize(obj2)).toBe('{"a":1,"b":2,"z":26}')
    expect(await computeContextHash(obj1)).toBe(await computeContextHash(obj2))
  })

  it('handles nested objects and arrays deterministically', async () => {
    const obj1 = { filters: { status: 'active', tags: ['a', 'b'] }, page: 1 }
    const obj2 = { page: 1, filters: { tags: ['a', 'b'], status: 'active' } }
    expect(canonicalJsonSerialize(obj1)).toBe(canonicalJsonSerialize(obj2))
    expect(await computeContextHash(obj1)).toBe(await computeContextHash(obj2))
  })

  it('omits undefined object properties', async () => {
    const obj1 = { page: 1, sort: undefined }
    const obj2 = { page: 1 }
    expect(canonicalJsonSerialize(obj1)).toBe('{"page":1}')
    expect(canonicalJsonSerialize(obj2)).toBe('{"page":1}')
    expect(await computeContextHash(obj1)).toBe(await computeContextHash(obj2))
  })

  it('produces distinct hashes for distinct contents', async () => {
    const hash1 = await computeContextHash({ page: 1 })
    const hash2 = await computeContextHash({ page: 2 })
    expect(hash1).toBeDefined()
    expect(hash2).toBeDefined()
    expect(hash1).not.toBe(hash2)
  })

  it('returns undefined for undefined context', async () => {
    expect(await computeContextHash(undefined)).toBeUndefined()
  })

  it('returns undefined for cyclic contexts while allowing shared non-cyclic references', async () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    const shared = { page: 1 }

    expect(canonicalJsonSerialize(cyclic)).toBeUndefined()
    expect(await computeContextHash(cyclic)).toBeUndefined()
    expect(canonicalJsonSerialize({ first: shared, second: shared })).toBe('{"first":{"page":1},"second":{"page":1}}')
  })

  it('serializes Date and objects with toJSON deterministically', async () => {
    const date1 = new Date('2026-01-01T00:00:00.000Z')
    const date2 = new Date('2026-01-02T00:00:00.000Z')
    expect(canonicalJsonSerialize(date1)).toBe('"2026-01-01T00:00:00.000Z"')
    expect(canonicalJsonSerialize(date2)).toBe('"2026-01-02T00:00:00.000Z"')
    expect(await computeContextHash(date1)).not.toBe(await computeContextHash(date2))

    const custom = {
      toJSON: () => ({ b: 2, a: 1 }),
    }
    expect(canonicalJsonSerialize(custom)).toBe('{"a":1,"b":2}')
  })

  it('uses Node.js fallback when crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', { subtle: undefined })
    try {
      const hash = await sha256('abc')
      expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
