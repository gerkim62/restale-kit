import { describe, expect, it } from 'vitest'
import { SSEInvalidatorClient as ClientCoreExport } from './client/core/index.js'
import { useReStale } from './client/react/index.js'
import { swrAdapter } from './client/swr/index.js'
import { tanstackQueryAdapter } from './client/tanstack-query/index.js'
import { createEventStore, createSSEChannel, SSEChannelGroup } from './server/core/index.js'
import { attachSSE as expressAttach } from './server/express/index.js'
import { attachSSE as fastifyAttach } from './server/fastify/index.js'
import { toSSEResponse as fetchToSSEResponse } from './server/fetch/index.js'
import { toSSEResponse as honoToSSEResponse } from './server/hono/index.js'
import { attachSSE as nodeAttach } from './server/node/index.js'
import { PubSubDecryptionError } from './pubsub/core/index.js'
import { ablyPubSubAdapter } from './pubsub/ably/index.js'
import { pusherPubSubAdapter } from './pubsub/pusher/index.js'
import { redisPubSubAdapter } from './pubsub/redis/index.js'
import {
  ChannelClosedError,
  isJSONValue,
  isJSONValueArray,
  matchesInvalidateSignalKey,
  SchemaValidationError,
  SIGNAL_TARGETS,
  validateStandardSchema,
} from './types/index.js'

describe('Entrypoint Re-exports', () => {
  it('correctly exports client modules', () => {
    expect(ClientCoreExport).toBeDefined()
    expect(useReStale).toBeDefined()
    expect(swrAdapter).toBeDefined()
    expect(tanstackQueryAdapter).toBeDefined()
  })

  it('correctly exports server modules', () => {
    expect(createSSEChannel).toBeDefined()
    expect(SSEChannelGroup).toBeDefined()
    expect(createEventStore).toBeDefined()
    expect(expressAttach).toBeDefined()
    expect(fastifyAttach).toBeDefined()
    expect(fetchToSSEResponse).toBeDefined()
    expect(honoToSSEResponse).toBeDefined()
    expect(nodeAttach).toBeDefined()
  })

  it('correctly exports pubsub modules', () => {
    expect(PubSubDecryptionError).toBeDefined()
    expect(redisPubSubAdapter).toBeDefined()
    expect(ablyPubSubAdapter).toBeDefined()
    expect(pusherPubSubAdapter).toBeDefined()
  })

  it('correctly exports types and protocol helpers', () => {
    expect(ChannelClosedError).toBeDefined()
    expect(SchemaValidationError).toBeDefined()
    expect(validateStandardSchema).toBeDefined()
    expect(isJSONValue).toBeDefined()
    expect(isJSONValueArray).toBeDefined()
    expect(matchesInvalidateSignalKey).toBeDefined()
    expect(SIGNAL_TARGETS).toBeDefined()
  })
})
