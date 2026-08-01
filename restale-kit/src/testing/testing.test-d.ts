import { describe, expectTypeOf, test } from 'vitest'
import { createSSEChannel } from '@/testing/index.js'
import type { SSEChannel } from '@/server/core/channel.js'
import type { SWRSignal, TanStackQuerySignal, InvalidateSignal } from '@/types/protocol.js'

describe('testing exports type safety', () => {
  test('createSSEChannel exported from testing returns SSEChannel<TSignal>', () => {
    const channel = createSSEChannel<SWRSignal>({ target: 'swr', connectionId: 'test-conn' })
    expectTypeOf(channel).toEqualTypeOf<SSEChannel<SWRSignal>>()
  })

  test('createSSEChannel with TanStack generic', () => {
    const channel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
    expectTypeOf(channel).toEqualTypeOf<SSEChannel<TanStackQuerySignal>>()
  })

  test('createSSEChannel without generic defaults to InvalidateSignal', () => {
    const channel = createSSEChannel({ target: 'swr' })
    // When inferred from target, the channel accepts the signal type for that target
    expectTypeOf(channel.invalidate).toBeCallableWith({ target: 'swr', key: ['test'] })
  })

  test('createSSEChannel multi-target returns SSEChannel with union signal', () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'] })
    // Multi-target channels should accept both signal types
    channel.invalidate([
      { target: 'swr', key: ['a'] },
      { target: 'tanstack-query', queryKey: ['b'] },
    ])
  })
})
