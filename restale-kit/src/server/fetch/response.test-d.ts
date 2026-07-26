import { describe, expectTypeOf, test } from 'vitest'
import { toSSEResponse } from '@/server/fetch/response.js'
import type { SSEChannel, SSEChannelOptions } from '@/server/core/channel.js'
import type { SWRSignal } from '@/types/index.js'

describe('toSSEResponse type safety', () => {
  test('toSSEResponse returns { response: Response, channel: SSEChannel<TSignal> }', () => {
    const mockRequest = {} as Request
    const options: SSEChannelOptions = { target: 'swr' }

    const result = toSSEResponse<SWRSignal>(mockRequest, options)
    expectTypeOf(result.response).toEqualTypeOf<Response>()
    expectTypeOf(result.channel).toEqualTypeOf<SSEChannel<SWRSignal>>()
  })
})
