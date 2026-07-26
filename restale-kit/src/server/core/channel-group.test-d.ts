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

    // Should infer SSEChannelGroup<SWRSignal>
    expectTypeOf(swrGroup).toEqualTypeOf<SSEChannelGroup<SWRSignal>>()

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
    group.publish('users-topic', { target: 'swr', key: ['users'] })
  })

  test('multi-target group broadcast requires explicit target on every signal', () => {
    const multiGroup = new SSEChannelGroup({ target: ['swr', 'tanstack-query'] })

    // @ts-expect-error multi-target group broadcast without explicit target on signal should be a type error
    multiGroup.broadcastToAll({ key: ['users'] })

    // @ts-expect-error multi-target group publish without explicit target on signal should be a type error
    multiGroup.publish('topic-name', { key: ['users'] })
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
    group.revokeWhere({ handler: () => {} })

    // @ts-expect-error symbols are not valid JSONValue criteria
    group.revokeWhere({ id: Symbol('test') })
  })

  test('broadcastByKey enforces TSignal generic', () => {
    const group = new SSEChannelGroup<TanStackQuerySignal>({ target: 'tanstack-query' })

    group.broadcastByKey({ target: 'tanstack-query', queryKey: ['todos'] })

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


