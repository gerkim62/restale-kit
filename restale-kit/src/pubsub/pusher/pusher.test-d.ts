import { describe, expectTypeOf, test } from 'vitest'
import { pusherPubSubAdapter, type PusherClient } from '@/pubsub/pusher/index.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import type { SWRSignal } from '@/types/index.js'

describe('pusherPubSubAdapter type safety', () => {
  test('pusherPubSubAdapter returns PubSubAdapter<TSignal> with handleWebhook', () => {
    const mockClient = {} as PusherClient
    const adapter = pusherPubSubAdapter<SWRSignal>(mockClient)

    expectTypeOf(adapter).toMatchTypeOf<PubSubAdapter<SWRSignal>>()
    expectTypeOf(adapter.handleWebhook).toBeCallableWith('raw-body', { 'x-pusher-signature': 'sig' })
  })

  test('pusherPubSubAdapter encryption options validation', () => {
    const mockClient = {} as PusherClient

    // @ts-expect-error encrypt: false combined with encryptionKey is an error
    pusherPubSubAdapter(mockClient, { encrypt: false, encryptionKey: 'key' })
  })
})
