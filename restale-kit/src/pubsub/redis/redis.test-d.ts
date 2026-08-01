import { describe, expectTypeOf, test } from 'vitest'
import { redisPubSubAdapter, type RedisClient } from '@/pubsub/redis/index.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import type { SWRSignal, TanStackQuerySignal } from '@/types/index.js'
import type { PubSubMessage } from '@/types/protocol.js'

describe('redisPubSubAdapter type safety', () => {
  test('redisPubSubAdapter returns PubSubAdapter<TSignal>', () => {
    const mockClient = {} as RedisClient
    const adapter = redisPubSubAdapter<SWRSignal>(mockClient)

    expectTypeOf(adapter).toEqualTypeOf<PubSubAdapter<SWRSignal>>()
    expectTypeOf(adapter.publish).toBeCallableWith('topic', { kind: 'signal', data: { target: 'swr', key: ['users'] } })
    expectTypeOf(adapter.subscribe).toBeCallableWith('topic', (_msg: PubSubMessage<SWRSignal>) => {})
    expectTypeOf(adapter.onError).toBeCallableWith((_err: unknown) => {})
  })

  test('redisPubSubAdapter publish rejects mismatched signal data', () => {
    const mockClient = {} as RedisClient
    const adapter = redisPubSubAdapter<SWRSignal>(mockClient)

    // @ts-expect-error TanStackQuerySignal data should be rejected on SWRSignal adapter
    void adapter.publish('topic', { kind: 'signal', data: { target: 'tanstack-query', queryKey: ['users'] } })
  })

  test('redisPubSubAdapter encryption options validation', () => {
    const mockClient = {} as RedisClient

    const disabled = redisPubSubAdapter(mockClient, { encrypt: false })
    const enabled = redisPubSubAdapter(mockClient, { encrypt: true, encryptionKey: '32-byte-secret-key-base64-or-hex' })
    expectTypeOf(disabled).toExtend<PubSubAdapter>()
    expectTypeOf(enabled).toExtend<PubSubAdapter>()

    // @ts-expect-error encrypt: false combined with encryptionKey is an error
    void redisPubSubAdapter(mockClient, { encrypt: false, encryptionKey: 'key' })
  })
})
