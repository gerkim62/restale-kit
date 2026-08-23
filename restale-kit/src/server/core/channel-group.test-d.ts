import { expectTypeOf, test } from 'vitest'
import type { InlineDataSignal, RevalidateSignal, Signal } from '@/types/index.js'
import type {
  InlineDataResolver,
  InlineDataResolverResult,
  SSEChannelGroupOptions,
} from '@/server/core/index.js'
import { SSEChannelGroup } from '@/server/core/index.js'
import type { ClusterFilter, LocalFilter } from '@/utils/filter.js'

test('signal type contracts', () => {
  const revalidate: RevalidateSignal = { key: ['todos'], exact: true }
  const inlineData: InlineDataSignal = { key: ['todos'], inlineData: { id: 1 }, markStale: false }
  expectTypeOf(revalidate).toExtend<Signal>()
  expectTypeOf(inlineData).toExtend<Signal>()

  // @ts-expect-error target routing is intentionally absent
  const targetSignal: Signal = { target: 'swr', key: ['todos'] }
  // @ts-expect-error inline-data signals cannot specify exact matching
  const invalidInlineData: InlineDataSignal = { key: ['todos'], inlineData: 1, exact: true }

  void targetSignal
  void invalidInlineData
})

test('InlineDataResolver and SSEChannelGroupOptions type contracts', () => {
  type Meta = { userId: string; orgId: string }
  type Context = { page: number }

  const resolver: InlineDataResolver<Meta, Context> = (connections, payload) => {
    expectTypeOf(connections[0].meta).toEqualTypeOf<Meta | undefined>()
    expectTypeOf(connections[0].clientContext).toEqualTypeOf<Context | undefined>()
    void payload
    return new Map<string, InlineDataResolverResult>([
      [connections[0].connectionId, { action: 'inlineData', signal: { key: ['todos'] }, inlineData: { ok: true } }],
      ['conn-revalidate', { action: 'revalidate', signal: { key: ['todos'] } }],
      ['conn-skip', { action: 'skip' }],
    ])
  }

  const options: SSEChannelGroupOptions<Meta, Context> = {
    secret: 'test-secret',
    scopeBy: ['userId', 'orgId'],
    inlineDataResolver: resolver,
    onInlineDataResolverError: (info) => {
      expectTypeOf(info.topic).toEqualTypeOf<string | undefined>()
      expectTypeOf(info.missingConnectionIds).toEqualTypeOf<readonly string[]>()
    },
  }

  expectTypeOf(options).toExtend<SSEChannelGroupOptions<Meta, Context>>()
})

test('SSEChannelGroup scopeBy conditional type enforcement', () => {
  interface UserMeta {
    userId: string
    teamId: string
    lastSeen: number
  }

  // 1. Unauthenticated app: TMeta is undefined -> scopeBy is optional
  const unauthGroup = new SSEChannelGroup({
    secret: 'test-secret',
  })
  expectTypeOf(unauthGroup).toBeObject()

  // 2. Authenticated app with typed TMeta -> scopeBy is REQUIRED
  const authGroup = new SSEChannelGroup<UserMeta>({
    secret: 'test-secret',
    scopeBy: ['userId'],
  })
  expectTypeOf(authGroup).toBeObject()

  // @ts-expect-error Missing required scopeBy when TMeta is typed
  const missingScopeBy = new SSEChannelGroup<UserMeta>({
    secret: 'test-secret',
  })
  void missingScopeBy

  const emptyScopeBy = new SSEChannelGroup<UserMeta>({
    secret: 'test-secret',
    // @ts-expect-error Empty scopeBy array is invalid when TMeta is typed
    scopeBy: [],
  })
  void emptyScopeBy

  const invalidKeyScopeBy = new SSEChannelGroup<UserMeta>({
    secret: 'test-secret',
    // @ts-expect-error Invalid key in scopeBy
    scopeBy: ['notAUserKey'],
  })
  void invalidKeyScopeBy
})

test('LocalFilter and ClusterFilter type contracts', () => {
  type Meta = { userId: string; role: string }

  const pred = (m: Meta | undefined) => m?.userId === '42'
  const obj = { userId: '42' }

  expectTypeOf(pred).toMatchTypeOf<LocalFilter<Meta>>()
  expectTypeOf(obj).toMatchTypeOf<LocalFilter<Meta>>()
  expectTypeOf(obj).toMatchTypeOf<ClusterFilter<Meta>>()

  // @ts-expect-error Predicate functions are not allowed in ClusterFilter
  const invalidClusterPred: ClusterFilter<Meta> = (m: Meta | undefined) => m?.userId === '42'
  void invalidClusterPred
})
