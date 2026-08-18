import { describe, expect, it } from 'vitest'
import { SSEInvalidatorClient as ClientCoreExport } from './client/core/index.js'
import { RestaleProvider, useRestale } from './client/react/index.js'
import { swrAdapter } from './client/swr/index.js'
import { tanstackQueryAdapter } from './client/tanstack-query/index.js'
import { PubSubDecryptionError } from './pubsub/core/index.js'
import { ablyPubSubAdapter } from './pubsub/ably/index.js'
import { pusherPubSubAdapter } from './pubsub/pusher/index.js'
import { redisPubSubAdapter } from './pubsub/redis/index.js'

describe('Entrypoint Re-exports', () => {
  it('correctly exports client modules', () => {
    expect(ClientCoreExport).toBeDefined()
    expect(RestaleProvider).toBeDefined()
    expect(useRestale).toBeDefined()
    expect(swrAdapter).toBeDefined()
    expect(tanstackQueryAdapter).toBeDefined()
  })

  it('correctly exports pubsub modules', () => {
    expect(PubSubDecryptionError).toBeDefined()
    expect(redisPubSubAdapter).toBeDefined()
    expect(ablyPubSubAdapter).toBeDefined()
    expect(pusherPubSubAdapter).toBeDefined()
  })
})
