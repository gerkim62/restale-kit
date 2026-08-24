import { describe, expect, it } from 'vitest'
import {
  deepSubsetMatch,
  matchesClusterFilter,
  matchesLocalFilter,
  type ClusterFilter,
  type LocalFilter,
} from './filter.js'

describe('Universal Filtering & Deep Subset Matching', () => {
  describe('deepSubsetMatch', () => {
    it('matches identical primitive values', () => {
      expect(deepSubsetMatch(42, 42)).toBe(true)
      expect(deepSubsetMatch('hello', 'hello')).toBe(true)
      expect(deepSubsetMatch(true, true)).toBe(true)
      expect(deepSubsetMatch(null, null)).toBe(true)
      expect(deepSubsetMatch(42, 43)).toBe(false)
      expect(deepSubsetMatch('a', 'b')).toBe(false)
      expect(deepSubsetMatch(null, undefined)).toBe(false)
    })

    it('matches object criteria as a subset', () => {
      expect(deepSubsetMatch({ userId: '42', orgId: 'eng', extra: 123 }, { userId: '42' })).toBe(true)
      expect(deepSubsetMatch({ userId: '42', orgId: 'eng' }, { userId: '42', orgId: 'eng' })).toBe(true)
      expect(deepSubsetMatch({ userId: '42' }, { userId: '42', orgId: 'eng' })).toBe(false)
      expect(deepSubsetMatch(null, { userId: '42' })).toBe(false)
      expect(deepSubsetMatch(undefined, { userId: '42' })).toBe(false)
    })

    it('matches nested objects recursively', () => {
      const actual = {
        user: { id: '42', profile: { role: 'admin', active: true } },
        org: 'test',
      }
      expect(deepSubsetMatch(actual, { user: { id: '42' } })).toBe(true)
      expect(deepSubsetMatch(actual, { user: { profile: { role: 'admin' } } })).toBe(true)
      expect(deepSubsetMatch(actual, { user: { profile: { role: 'user' } } })).toBe(false)
    })

    it('matches array elements by order-independent containment', () => {
      expect(deepSubsetMatch(['a', 'b', 'c'], ['a', 'b'])).toBe(true)
      expect(deepSubsetMatch(['c', 'b', 'a'], ['a', 'b'])).toBe(true)
      expect(deepSubsetMatch(['b', 'a'], ['a', 'b'])).toBe(true)
      expect(deepSubsetMatch(['a'], ['a', 'b'])).toBe(false)
      expect(deepSubsetMatch(['x', 'y'], ['a'])).toBe(false)
      expect(deepSubsetMatch([], [])).toBe(true)
      expect(deepSubsetMatch(['a'], [])).toBe(true)
    })

    it('matches array of objects with deep containment', () => {
      const actual = {
        roles: [
          { name: 'editor', permissions: ['read', 'write'] },
          { name: 'admin', permissions: ['all'] },
        ],
      }

      expect(
        deepSubsetMatch(actual, {
          roles: [{ name: 'admin' }],
        }),
      ).toBe(true)

      expect(
        deepSubsetMatch(actual, {
          roles: [{ name: 'admin' }, { name: 'editor' }],
        }),
      ).toBe(true)

      expect(
        deepSubsetMatch(actual, {
          roles: [{ name: 'viewer' }],
        }),
      ).toBe(false)
    })

    it('returns false when expected is array but actual is not an array', () => {
      expect(deepSubsetMatch('hello', ['hello'])).toBe(false)
      expect(deepSubsetMatch(42, [42])).toBe(false)
      expect(deepSubsetMatch({ 0: 'a' }, ['a'])).toBe(false)
      expect(deepSubsetMatch(null, ['a'])).toBe(false)
    })

    it('returns false when expected is an object but actual is not a plain object', () => {
      expect(deepSubsetMatch(['a'], { a: 1 })).toBe(false)
      expect(deepSubsetMatch('primitive', { a: 1 })).toBe(false)
      expect(deepSubsetMatch(123, { a: 1 })).toBe(false)
    })

    it('matches when expected object property has undefined value', () => {
      expect(deepSubsetMatch({ a: 1 }, { a: 1, b: undefined })).toBe(true)
      expect(deepSubsetMatch({ a: 1, b: 2 }, { a: 1, b: undefined })).toBe(true)
    })
  })

  describe('matchesLocalFilter', () => {
    interface UserMeta {
      userId: string
      roles: string[]
      teamId?: string
    }

    const meta: UserMeta = {
      userId: '42',
      roles: ['user', 'admin'],
      teamId: 'eng',
    }

    it('matches when filter is literal true', () => {
      expect(matchesLocalFilter(meta, true)).toBe(true)
      expect(matchesLocalFilter(undefined, true)).toBe(true)
    })

    it('matches using a predicate function', () => {
      expect(matchesLocalFilter(meta, (m) => m?.userId === '42')).toBe(true)
      expect(matchesLocalFilter(meta, (m) => m?.userId === '99')).toBe(false)
      expect(matchesLocalFilter(undefined, (m) => m === undefined)).toBe(true)
    })

    it('matches using object criteria', () => {
      expect(matchesLocalFilter(meta, { userId: '42' })).toBe(true)
      expect(matchesLocalFilter(meta, { roles: ['admin'] })).toBe(true)
      expect(matchesLocalFilter(meta, { roles: ['admin', 'user'] })).toBe(true)
      expect(matchesLocalFilter(meta, { roles: ['superadmin'] })).toBe(false)
    })

    it('throws TypeError when filter is undefined, false, null, or invalid type', () => {
      expect(() => matchesLocalFilter(meta, undefined as unknown as LocalFilter<UserMeta>)).toThrow(TypeError)
      expect(() => matchesLocalFilter(meta, false as unknown as LocalFilter<UserMeta>)).toThrow(TypeError)
      expect(() => matchesLocalFilter(meta, null as unknown as LocalFilter<UserMeta>)).toThrow(TypeError)
      expect(() => matchesLocalFilter(meta, 123 as unknown as LocalFilter<UserMeta>)).toThrow(TypeError)
      expect(() => matchesLocalFilter(meta, 'invalid' as unknown as LocalFilter<UserMeta>)).toThrow(TypeError)
    })
  })

  describe('matchesClusterFilter', () => {
    interface UserMeta {
      userId: string
      teamId: string
    }

    const meta: UserMeta = { userId: '42', teamId: 'eng' }

    it('matches when cluster filter is literal true', () => {
      expect(matchesClusterFilter(meta, true)).toBe(true)
      expect(matchesClusterFilter(undefined, true)).toBe(true)
    })

    it('matches when cluster filter is object criteria', () => {
      expect(matchesClusterFilter(meta, { userId: '42' })).toBe(true)
      expect(matchesClusterFilter(meta, { teamId: 'marketing' })).toBe(false)
    })

    it('throws TypeError when predicate function is passed to cluster filter', () => {
      expect(() =>
        matchesClusterFilter(meta, ((m: UserMeta) => m.userId === '42') as unknown as ClusterFilter<UserMeta>),
      ).toThrow(TypeError)
    })

    it('throws TypeError when cluster filter is undefined, false, null, or invalid type', () => {
      expect(() => matchesClusterFilter(meta, undefined as unknown as ClusterFilter<UserMeta>)).toThrow(TypeError)
      expect(() => matchesClusterFilter(meta, false as unknown as ClusterFilter<UserMeta>)).toThrow(TypeError)
      expect(() => matchesClusterFilter(meta, null as unknown as ClusterFilter<UserMeta>)).toThrow(TypeError)
      expect(() => matchesClusterFilter(meta, 42 as unknown as ClusterFilter<UserMeta>)).toThrow(TypeError)
      expect(() => matchesClusterFilter(meta, 'invalid' as unknown as ClusterFilter<UserMeta>)).toThrow(TypeError)
    })
  })
})
