import { expectTypeOf, test } from 'vitest'
import type { ClusterFilter, LocalFilter } from '@/utils/filter.js'
import { deepSubsetMatch, matchesClusterFilter, matchesLocalFilter } from '@/utils/filter.js'

test('Filter function signatures and return types', () => {
  interface UserMeta {
    userId: string
    role: string
    tags: string[]
  }

  const meta: UserMeta = {
    userId: 'u-1',
    role: 'admin',
    tags: ['dev', 'ops'],
  }

  // LocalFilter allows boolean, predicate function, or partial object
  const localBool: LocalFilter<UserMeta> = true
  const localPred: LocalFilter<UserMeta> = (m) => m?.role === 'admin'
  const localObj: LocalFilter<UserMeta> = { role: 'admin' }

  expectTypeOf(matchesLocalFilter(meta, localBool)).toEqualTypeOf<boolean>()
  expectTypeOf(matchesLocalFilter(meta, localPred)).toEqualTypeOf<boolean>()
  expectTypeOf(matchesLocalFilter(meta, localObj)).toEqualTypeOf<boolean>()

  // ClusterFilter allows boolean or partial object (no functions)
  const clusterBool: ClusterFilter<UserMeta> = true
  const clusterObj: ClusterFilter<UserMeta> = { role: 'admin' }

  expectTypeOf(matchesClusterFilter(meta, clusterBool)).toEqualTypeOf<boolean>()
  expectTypeOf(matchesClusterFilter(meta, clusterObj)).toEqualTypeOf<boolean>()

  // deepSubsetMatch takes unknown actual and expected, returns boolean
  expectTypeOf(deepSubsetMatch(meta, { role: 'admin' })).toEqualTypeOf<boolean>()
  expectTypeOf(deepSubsetMatch([1, 2, 3], [2, 1])).toEqualTypeOf<boolean>()
})
