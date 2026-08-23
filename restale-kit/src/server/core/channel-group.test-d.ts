import { expectTypeOf, test } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { InlineDataSignal, JSONValue, RevalidateSignal, Signal } from '@/types/index.js'
import type {
  ChannelSetupOptions,
  InlineDataConnection,
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
    expectTypeOf(connections[0].connectionId).toEqualTypeOf<string>()
    expectTypeOf(connections[0].meta).toEqualTypeOf<Meta | undefined>()
    expectTypeOf(connections[0].clientContext).toEqualTypeOf<Context | undefined>()
    expectTypeOf(payload).toMatchTypeOf<JSONValue>()
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

test('group.local.* method signatures and return types', () => {
  interface UserMeta {
    userId: string
    orgId: string
  }

  const group = new SSEChannelGroup<UserMeta>({
    secret: 'test-secret',
    scopeBy: ['userId'],
    inlineDataResolver: () => new Map(),
  })

  // 1. group.local.size is a number getter
  expectTypeOf(group.local.size).toEqualTypeOf<number>()

  // 2. group.local.broadcast returns { sent: number, errors: number } synchronously
  const bRes = group.local.broadcast({ key: ['items'] }, { userId: '42' })
  expectTypeOf(bRes).toEqualTypeOf<{ sent: number; errors: number }>()

  // @ts-expect-error missing filter is rejected
  group.local.broadcast({ key: ['items'] })

  // 3. group.local.revokeWhere returns { revoked: number } synchronously
  const rRes = group.local.revokeWhere({ userId: '42' })
  expectTypeOf(rRes).toEqualTypeOf<{ revoked: number }>()

  // @ts-expect-error missing filter is rejected
  group.local.revokeWhere()

  // 4. group.local.revokeByConnectionId returns { closed: boolean } synchronously
  const idRes = group.local.revokeByConnectionId('conn-123', { userId: '42' })
  expectTypeOf(idRes).toEqualTypeOf<{ closed: boolean }>()

  // 5. group.local.pushInlineData returns Promise<void>
  const pushRes = group.local.pushInlineData({ payload: 123 }, { userId: '42' })
  expectTypeOf(pushRes).toEqualTypeOf<Promise<void>>()
})

test('group.cluster.* method signatures and return types', () => {
  interface UserMeta {
    userId: string
  }

  const group = new SSEChannelGroup<UserMeta>({
    secret: 'test-secret',
    scopeBy: ['userId'],
  })

  // 1. group.cluster.broadcast returns Promise<void>
  const bRes = group.cluster.broadcast('news', { key: ['articles'] })
  expectTypeOf(bRes).toEqualTypeOf<Promise<void>>()

  // 2. group.cluster.revokeWhere returns Promise<void>
  const rwRes = group.cluster.revokeWhere({ userId: '42' })
  expectTypeOf(rwRes).toEqualTypeOf<Promise<void>>()

  // @ts-expect-error predicate function not allowed in ClusterFilter
  group.cluster.revokeWhere((m) => m?.userId === '42')

  // 3. group.cluster.revokeByConnectionId returns Promise<void>
  const rIdRes = group.cluster.revokeByConnectionId('conn-123', { userId: '42' })
  expectTypeOf(rIdRes).toEqualTypeOf<Promise<void>>()

  // 4. group.cluster.pushInlineData returns Promise<void>
  const pRes = group.cluster.pushInlineData('updates', { data: 'val' })
  expectTypeOf(pRes).toEqualTypeOf<Promise<void>>()
})

test('group.handle() polymorphic overload signatures', () => {
  interface UserMeta {
    userId: string
  }

  const group = new SSEChannelGroup<UserMeta>({
    secret: 'test-secret',
    scopeBy: ['userId'],
  })

  const reqNode = {} as IncomingMessage
  const resNode = {} as ServerResponse
  const nodeOptions: ChannelSetupOptions<UserMeta> = {
    meta: { userId: '42' },
    topics: ['news'],
  }

  // Node overload returns Promise<void>
  const nodeHandle = group.handle(reqNode, resNode, nodeOptions)
  expectTypeOf(nodeHandle).toEqualTypeOf<Promise<void>>()

  // Fetch overload returns Promise<Response>
  const reqFetch = new Request('https://example.com/sse')
  const fetchHandle = group.handle(reqFetch, { meta: { userId: '42' } })
  expectTypeOf(fetchHandle).toEqualTypeOf<Promise<Response>>()
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
