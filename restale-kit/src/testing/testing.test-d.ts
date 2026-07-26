import { describe, expectTypeOf, test } from 'vitest'
import { createSSEChannel } from '@/testing/index.js'
import type { SSEChannel } from '@/server/core/channel.js'
import type { SWRSignal } from '@/types/index.js'

describe('testing exports type safety', () => {
  test('createSSEChannel exported from testing returns SSEChannel<TSignal>', () => {
    const channel = createSSEChannel<SWRSignal>({ target: 'swr', connectionId: 'test-conn' })
    expectTypeOf(channel).toEqualTypeOf<SSEChannel<SWRSignal>>()
  })
})
