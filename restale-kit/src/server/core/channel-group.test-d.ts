import { describe, expectTypeOf, test } from 'vitest'
import { SSEChannelGroup, type SSEChannelGroupOptions, type ChannelSetupOptions } from '@/server/core/index.js'
import { createSSEChannel } from '@/testing/index.js'
import type {
  InvalidateSignal,
  SWRSignal,
  TanStackQuerySignal,
  JSONValue,
} from '@/types/index.js'

describe('SSEChannelGroup generic and metadata enforcement', () => {
  test('register requires metadata when TMeta is defined and non-optional', () => {
    interface UserMeta {
      userId: string
      role: string
    }

    const group = new SSEChannelGroup<TanStackQuerySignal, UserMeta>()
    const channel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })

    // Valid registration with required metadata
    group.register(channel, { userId: 'u1', role: 'admin' })

    // @ts-expect-error missing required metadata parameter
    group.register(channel)

    // @ts-expect-error invalid metadata properties
    group.register(channel, { userId: 'u1', invalidProp: true })
  })

  test('register allows optional metadata when TMeta is unknown or includes undefined', () => {
    const defaultGroup = new SSEChannelGroup()
    const channel = createSSEChannel({ target: 'swr' })

    // Optional metadata allowed
    defaultGroup.register(channel)
    defaultGroup.register(channel, { custom: 'data' })
  })

  test('SSEChannelGroup target option should infer TSignal generic', () => {
    const swrGroup = new SSEChannelGroup({ target: 'swr' })

    expectTypeOf(swrGroup).toEqualTypeOf<SSEChannelGroup<SWRSignal, unknown, 'swr'>>()

    // @ts-expect-error explicit generic mismatched with target option should be a type error
    new SSEChannelGroup<SWRSignal>({ target: 'tanstack-query' })
  })
})

describe('SSEChannelGroup signal broadcasting type safety', () => {
  test('broadcast methods enforce TSignal type', () => {
    const group = new SSEChannelGroup<TanStackQuerySignal>({ target: 'tanstack-query' })

    // Valid TanStackQuerySignal compiles
    group.broadcastToAll({ target: 'tanstack-query', queryKey: ['users'] })
    group.broadcast({ target: 'tanstack-query', queryKey: ['users'] }, () => true)

    // @ts-expect-error SWRSignal should be rejected when group is typed TanStackQuerySignal
    group.broadcastToAll({ target: 'swr', key: ['users'] })

    // @ts-expect-error SWRSignal should be rejected in publish
    void group.publish('users-topic', { target: 'swr', key: ['users'] })
  })

  test('multi-target group broadcast requires explicit target on every signal', () => {
    const multiGroup = new SSEChannelGroup({ target: ['swr', 'tanstack-query'] as const })

    // @ts-expect-error multi-target groups require one explicitly targeted signal per configured target
    multiGroup.broadcastToAll({ key: ['users'] })

    // @ts-expect-error multi-target groups require one explicitly targeted signal per configured target
    void multiGroup.publish('topic-name', { key: ['users'] })

    // @ts-expect-error an empty batch cannot cover either configured target
    multiGroup.broadcastToAll([])

    // @ts-expect-error an empty batch cannot cover either configured target
    void multiGroup.publish('topic-name', [])

    // @ts-expect-error key-based broadcasts cannot construct a complete multi-target batch
    multiGroup.broadcastByKey({ target: 'swr', key: ['users'] })
  })

  test('single-target group injects an omitted target', () => {
    const swrGroup = new SSEChannelGroup({ target: 'swr' })

    swrGroup.broadcastToAll({ key: ['users'] })
    void swrGroup.publish('topic-name', { key: ['users'] })
  })
})

describe('SSEChannelGroup revocation methods', () => {
  test('revokeWhere accepts valid JSONValue criteria', () => {
    const group = new SSEChannelGroup()

    expectTypeOf(group.revokeWhere).toBeCallableWith({ userId: 'u123', active: true })
    expectTypeOf(group.revokeByConnectionId).toBeCallableWith('conn-123')
    expectTypeOf(group.revokeByConnectionId).toBeCallableWith('conn-123', { tenantId: 't1' })
  })

  test('revokeWhere rejects non-JSONValue criteria', () => {
    const group = new SSEChannelGroup()

    // @ts-expect-error functions are not valid JSONValue criteria
    void group.revokeWhere({ handler: () => {} })

    // @ts-expect-error symbols are not valid JSONValue criteria
    void group.revokeWhere({ id: Symbol('test') })
  })


})

describe('SSEChannelGroup attachNodeResponse and createFetchResponse 1-step methods', () => {
  test('attachNodeResponse accepts Node HTTP req/res and Fastify request/reply', () => {
    const group = new SSEChannelGroup<SWRSignal>({ channelDefaults: { target: 'swr' } })

    const mockNodeReq = {} as import('node:http').IncomingMessage
    const mockNodeRes = {} as import('node:http').ServerResponse
    const attachResult = group.attachNodeResponse(mockNodeReq, mockNodeRes, {})
    expectTypeOf(attachResult).toEqualTypeOf<{ channel: import('@/server/core/index.js').SSEChannel<SWRSignal> }>()

    const mockFastifyReq = {} as import('@/server/core/index.js').FastifyRequestLike
    const mockFastifyRes = {} as import('@/server/core/index.js').FastifyReplyLike
    const fastifyAttachResult = group.attachNodeResponse(mockFastifyReq, mockFastifyRes, {})
    expectTypeOf(fastifyAttachResult).toEqualTypeOf<{ channel: import('@/server/core/index.js').SSEChannel<SWRSignal> }>()
  })
  

  test('createFetchResponse returns Fetch Response and channel', () => {
    const group = new SSEChannelGroup<SWRSignal>({ channelDefaults: { target: 'swr' } })
    const mockRequest = {} as Request

    const createResult = group.createFetchResponse(mockRequest, {})
    expectTypeOf(createResult.response).toEqualTypeOf<Response>()
    expectTypeOf(createResult.channel).toEqualTypeOf<import('@/server/core/index.js').SSEChannel<SWRSignal>>()
  })
})

describe('SSEChannelGroup deregister and dispose types', () => {
  test('deregister accepts SSEChannel<TSignal> and returns void', () => {
    const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' })
    const channel = createSSEChannel<SWRSignal>({ target: 'swr' })

    expectTypeOf(group.deregister).toBeCallableWith(channel)
    expectTypeOf(group.deregister).returns.toEqualTypeOf<void>()
  })

  test('dispose returns Promise<void>', () => {
    const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' })

    expectTypeOf(group.dispose).returns.toEqualTypeOf<Promise<void>>()
  })
})

describe('SSEChannelGroup publish type safety', () => {
  test('publish returns Promise<void>', () => {
    const group = new SSEChannelGroup<TanStackQuerySignal>({ target: 'tanstack-query' })

    expectTypeOf(
      group.publish('topic', { target: 'tanstack-query', queryKey: ['test'] })
    ).toEqualTypeOf<Promise<void>>()
  })

  test('publish accepts batch signals', () => {
    const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' })

    expectTypeOf(group.publish).toBeCallableWith('topic', [
      { target: 'swr', key: ['a'] },
      { target: 'swr', key: ['b'] },
    ])
  })
})

describe('SSEChannelGroup broadcastByKey type safety', () => {
  test('broadcastByKey accepts a single TSignal', () => {
    const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' })

    expectTypeOf(group.broadcastByKey).toBeCallableWith({
      target: 'swr',
      key: ['todos'],
    })
  })

  test('broadcastByKey returns void', () => {
    const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' })

    expectTypeOf(group.broadcastByKey).returns.toEqualTypeOf<void>()
  })

  test('broadcastByKey rejects mismatched signal type', () => {
    const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' })

    // @ts-expect-error TanStack signal rejected on SWR group
    group.broadcastByKey({ target: 'tanstack-query', queryKey: ['test'] })
  })
})

describe('SSEChannelGroup size property', () => {
  test('size returns number', () => {
    const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' })

    expectTypeOf(group.size).toEqualTypeOf<number>()
  })
})

describe('SSEChannelGroup revokeByConnectionId return type', () => {
  test('revokeByConnectionId returns Promise<{ closed: boolean }>', () => {
    const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' })

    expectTypeOf(
      group.revokeByConnectionId('conn-1')
    ).toEqualTypeOf<Promise<{ closed: boolean }>>()
  })

  test('revokeWhere returns Promise<{ localClosed: number }>', () => {
    const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' })

    expectTypeOf(
      group.revokeWhere({ userId: 'u1' })
    ).toEqualTypeOf<Promise<{ localClosed: number }>>()
  })

  test('revokeByConnectionId type checks scope against Partial<TMeta>', () => {
    interface UserMeta {
      userId: number
      role?: string
    }
    const group = new SSEChannelGroup<TanStackQuerySignal, UserMeta>()

    // Valid scope with matching keys and optional undefined
    void group.revokeByConnectionId('conn-1', { userId: 123 })
    void group.revokeByConnectionId('conn-1', { userId: 123, role: undefined })

    // @ts-expect-error key typo 'user_id' is rejected by compiler
    void group.revokeByConnectionId('conn-1', { user_id: 123 })
  })
})

describe('SSEChannelGroup constructor metaSchema auto-inference', () => {
  test('infers TMeta automatically from metaSchema option', () => {
    type UserMeta = { userId: number }
    const metaSchema = {} as import('@/types/index.js').StandardSchemaV1<unknown, UserMeta>
    const group = new SSEChannelGroup({ metaSchema })

    expectTypeOf(group).toEqualTypeOf<SSEChannelGroup<InvalidateSignal, UserMeta>>()
    group.broadcast({ target: 'swr', key: ['test'] }, (meta) => {
      expectTypeOf(meta).toEqualTypeOf<UserMeta | undefined>()
      return true
    })
  })
})

describe('SSEChannelGroup clientContext type safety', () => {
  test('keeps TTarget positional compatibility and constrains client context after it', () => {
    interface UserMeta { userId: number; role?: string }
    interface PushContext { page?: number; sortBy?: string }
    const group = new SSEChannelGroup<TanStackQuerySignal, UserMeta, 'tanstack-query', PushContext>({
      target: 'tanstack-query',
    })

    void group.updateClientContext('conn-1', { page: 2, sortBy: 'createdAt' }, { scope: { userId: 123 } })
    void group.updateClientContext('conn-1', { page: 2 }, { scope: { userId: 123 } })
    expectTypeOf(group.getClientContext('conn-1')).toEqualTypeOf<PushContext | undefined>()
    expectTypeOf(group.updateClientContext('conn-1', { page: 1 }, { scope: { userId: 123 } }))
      .toEqualTypeOf<Promise<{ updated: boolean }>>()

    // @ts-expect-error context keys are constrained to TClientContext
    void group.updateClientContext('conn-1', { page: 2, userId: 'spoofed' }, { scope: { userId: 123 } })
    // @ts-expect-error known context fields retain their declared value type
    void group.updateClientContext('conn-1', { page: 'two' }, { scope: { userId: 123 } })
    // @ts-expect-error scope remains constrained by trusted TMeta
    void group.updateClientContext('conn-1', { page: 2 }, { scope: { user_id: 123 } })
    // @ts-expect-error scope option is required
    void group.updateClientContext('conn-1', { page: 2 })
  })

  test('infers TClientContext from a standalone clientContextSchema', () => {
    type PushContext = { page?: number }
    const clientContextSchema = {} as import('@/types/index.js').StandardSchemaV1<unknown, PushContext>
    const group = new SSEChannelGroup({ clientContextSchema })

    void group.updateClientContext('conn-1', { page: 2 }, { scope: { key: 'val' } })
    expectTypeOf(group.getClientContext('conn-1')).toEqualTypeOf<PushContext | undefined>()

    // @ts-expect-error schema output excludes undeclared context keys
    void group.updateClientContext('conn-1', { page: 2, userId: 'spoofed' }, { scope: { key: 'val' } })
  })

  test('defaults TClientContext to unknown when omitted', () => {
    const group = new SSEChannelGroup<TanStackQuerySignal>({ target: 'tanstack-query' })
    expectTypeOf(group.getClientContext('conn-1')).toEqualTypeOf<unknown>()
    void group.updateClientContext('conn-1', { arbitrary: 'shape' }, { scope: { key: 'val' } })
  })
})

