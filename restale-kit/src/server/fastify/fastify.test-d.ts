import { describe, expectTypeOf, test } from 'vitest'
import { attachSSE, type FastifyReplyLike, type FastifyRequestLike } from '@/server/fastify/index.js'
import type { SSEChannel, SSEChannelOptions } from '@/server/core/channel.js'
import type { TanStackQuerySignal } from '@/types/index.js'

describe('fastify attachSSE type safety', () => {
  test('fastify attachSSE returns SSEChannel<TSignal>', () => {
    const mockReq = {} as FastifyRequestLike
    const mockRes = {} as FastifyReplyLike
    const options: SSEChannelOptions = { target: 'tanstack-query' }

    const channel = attachSSE<TanStackQuerySignal>(mockReq, mockRes, options)
    expectTypeOf(channel).toEqualTypeOf<SSEChannel<TanStackQuerySignal>>()
  })
})
