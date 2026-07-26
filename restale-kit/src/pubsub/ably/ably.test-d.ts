import { describe, expectTypeOf, test } from 'vitest'
import { ablyPubSubAdapter, type AblyClient } from '@/pubsub/ably/index.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import type { TanStackQuerySignal, SWRSignal } from '@/types/index.js'
import type { PubSubMessage } from '@/types/protocol.js'

describe('ablyPubSubAdapter type safety', () => {
  test('ablyPubSubAdapter returns PubSubAdapter<TSignal>', () => {
    const mockClient = {} as AblyClient
    const adapter = ablyPubSubAdapter<TanStackQuerySignal>(mockClient, { useNativeEchoSuppression: true })

    expectTypeOf(adapter).toEqualTypeOf<PubSubAdapter<TanStackQuerySignal>>()
    expectTypeOf(adapter.publish).toBeCallableWith('topic', { kind: 'signal', data: { target: 'tanstack-query', queryKey: ['users'] } })
    expectTypeOf(adapter.subscribe).toBeCallableWith('topic', (_msg: PubSubMessage<TanStackQuerySignal>) => {})
    expectTypeOf(adapter.onError).toBeCallableWith((_err: unknown) => {})
  })

  test('ablyPubSubAdapter publish rejects mismatched signal data', () => {
    const mockClient = {} as AblyClient
    const adapter = ablyPubSubAdapter<TanStackQuerySignal>(mockClient, { useNativeEchoSuppression: true })

    // @ts-expect-error SWRSignal data should be rejected on TanStackQuerySignal adapter
    adapter.publish('topic', { kind: 'signal', data: { target: 'swr', key: ['users'] } })
  })

  test('ablyPubSubAdapter encryption options validation', () => {
    const mockClient = {} as AblyClient

    // @ts-expect-error encrypt: false combined with encryptionKey is an error
    ablyPubSubAdapter(mockClient, { encrypt: false, encryptionKey: 'key' })
  })
})

