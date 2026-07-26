import { describe, expectTypeOf, test } from 'vitest'
import { redisPubSubAdapter, type RedisClient } from '@/pubsub/redis/index.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import type { SWRSignal } from '@/types/index.js'

describe('redisPubSubAdapter type safety', () => {
  test('redisPubSubAdapter returns PubSubAdapter<TSignal>', () => {
    const mockClient = {} as RedisClient
    const adapter = redisPubSubAdapter<SWRSignal>(mockClient)

    expectTypeOf(adapter).toEqualTypeOf<PubSubAdapter<SWRSignal>>()
  })

  test('redisPubSubAdapter encryption options validation', () => {
    const mockClient = {} as RedisClient

    // @ts-expect-error encrypt: false combined with encryptionKey is an error
    redisPubSubAdapter(mockClient, { encrypt: false, encryptionKey: 'key' })
  })
})
