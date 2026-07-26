import { describe, expectTypeOf, test } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { attachSSE, type FastifyReplyLike, type FastifyRequestLike } from '@/server/node/attach.js'
import type { SSEChannel, SSEChannelOptions } from '@/server/core/channel.js'
import type { SWRSignal } from '@/types/index.js'

describe('attachSSE type safety', () => {
  test('attachSSE returns SSEChannel<TSignal>', () => {
    const mockReq = {} as IncomingMessage
    const mockRes = {} as ServerResponse
    const options: SSEChannelOptions = { target: 'swr' }

    const channel = attachSSE<SWRSignal>(mockReq, mockRes, options)
    expectTypeOf(channel).toEqualTypeOf<SSEChannel<SWRSignal>>()
  })

  test('attachSSE accepts FastifyRequestLike and FastifyReplyLike', () => {
    const mockReq = {} as FastifyRequestLike
    const mockRes = {} as FastifyReplyLike
    const options: SSEChannelOptions = { target: 'swr' }

    const channel = attachSSE(mockReq, mockRes, options)
    expectTypeOf(channel).toMatchTypeOf<SSEChannel>()
  })
})
