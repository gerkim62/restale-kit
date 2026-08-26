import { describe, expect, it } from 'vitest'
import { SSEClient as ClientCoreExport } from './client/core/index'
import { RestaleProvider, useRestale } from './client/react/index'
import { swrAdapter } from './client/swr/index'
import { tanstackQueryAdapter } from './client/tanstack-query/index'
import { PubSubDecryptionError } from './pubsub/core/index'
import { ablyPubSubAdapter } from './pubsub/ably/index'
import { pusherPubSubAdapter } from './pubsub/pusher/index'
import { redisPubSubAdapter } from './pubsub/redis/index'

import { SSEChannelGroup, createSSEChannel, createEventStore } from './server/core/index'

describe('Entrypoint Re-exports', () => {
  it('correctly exports client modules', () => {
    expect(ClientCoreExport).toBeDefined()
    expect(RestaleProvider).toBeDefined()
    expect(useRestale).toBeDefined()
    expect(swrAdapter).toBeDefined()
    expect(tanstackQueryAdapter).toBeDefined()
  })

  it('correctly exports server modules', () => {
    expect(SSEChannelGroup).toBeDefined()
    expect(createSSEChannel).toBeDefined()
    expect(createEventStore).toBeDefined()
  })

  it('correctly exports pubsub modules', () => {
    expect(PubSubDecryptionError).toBeDefined()
    expect(redisPubSubAdapter).toBeDefined()
    expect(ablyPubSubAdapter).toBeDefined()
    expect(pusherPubSubAdapter).toBeDefined()
  })
})
