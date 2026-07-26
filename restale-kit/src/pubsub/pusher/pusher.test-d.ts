import { describe, expectTypeOf, test } from 'vitest'
import { pusherPubSubAdapter, type PusherClient } from '@/pubsub/pusher/index.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import type { SWRSignal, TanStackQuerySignal } from '@/types/index.js'
import type { PubSubMessage } from '@/types/protocol.js'

describe('pusherPubSubAdapter type safety', () => {
  test('pusherPubSubAdapter returns PubSubAdapter<TSignal> with handleWebhook', () => {
    const mockClient = {} as PusherClient
    const adapter = pusherPubSubAdapter<SWRSignal>(mockClient)

    expectTypeOf(adapter).toMatchTypeOf<PubSubAdapter<SWRSignal>>()
    expectTypeOf(adapter.publish).toBeCallableWith('topic', { kind: 'signal', data: { target: 'swr', key: ['users'] } })
    expectTypeOf(adapter.subscribe).toBeCallableWith('topic', (_msg: PubSubMessage<SWRSignal>) => {})
    expectTypeOf(adapter.handleWebhook).toBeCallableWith('raw-body', { 'x-pusher-signature': 'sig' })
  })

  test('pusherPubSubAdapter publish rejects mismatched signal data', () => {
    const mockClient = {} as PusherClient
    const adapter = pusherPubSubAdapter<SWRSignal>(mockClient)

    // @ts-expect-error TanStackQuerySignal data should be rejected on SWRSignal adapter
    adapter.publish('topic', { kind: 'signal', data: { target: 'tanstack-query', queryKey: ['users'] } })
  })

  test('pusherPubSubAdapter encryption options validation', () => {
    const mockClient = {} as PusherClient

    // @ts-expect-error encrypt: false combined with encryptionKey is an error
    pusherPubSubAdapter(mockClient, { encrypt: false, encryptionKey: 'key' })
  })
})

