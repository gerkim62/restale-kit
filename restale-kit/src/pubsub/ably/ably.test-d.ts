import { describe, expectTypeOf, test } from 'vitest'
import { ablyPubSubAdapter, type AblyClient } from '@/pubsub/ably/index.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import type { TanStackQuerySignal } from '@/types/index.js'

describe('ablyPubSubAdapter type safety', () => {
  test('ablyPubSubAdapter returns PubSubAdapter<TSignal>', () => {
    const mockClient = {} as AblyClient
    const adapter = ablyPubSubAdapter<TanStackQuerySignal>(mockClient, { useNativeEchoSuppression: true })

    expectTypeOf(adapter).toEqualTypeOf<PubSubAdapter<TanStackQuerySignal>>()
  })

  test('ablyPubSubAdapter encryption options validation', () => {
    const mockClient = {} as AblyClient

    // @ts-expect-error encrypt: false combined with encryptionKey is an error
    ablyPubSubAdapter(mockClient, { encrypt: false, encryptionKey: 'key' })
  })
})
