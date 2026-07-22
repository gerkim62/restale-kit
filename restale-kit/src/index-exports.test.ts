import { describe, expect, it } from 'vitest'
import { SSEInvalidatorClient as ClientCoreExport } from './client/core/index.js'
import { useReStale } from './client/react/index.js'
import { swrAdapter } from './client/swr/index.js'
import { tanstackQueryAdapter } from './client/tanstack-query/index.js'
import { createEventStore, SSEChannelGroup } from './server/core/index.js'
import { createSSEChannel } from './testing/index.js'
import { PubSubDecryptionError } from './pubsub/core/index.js'
import { ablyPubSubAdapter } from './pubsub/ably/index.js'
import { pusherPubSubAdapter } from './pubsub/pusher/index.js'
import { redisPubSubAdapter } from './pubsub/redis/index.js'
import {
  ChannelClosedError,
  isJSONValue,
  isJSONValueArray,
  matchesInvalidateSignalKey,
  RenewEventDetail,
  RevokeEventDetail,
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

  it('correctly exports server modules and testing utilities', () => {
    expect(SSEChannelGroup).toBeDefined()
    expect(createEventStore).toBeDefined()
    expect(SSEChannelGroup.prototype.createChannel).toBeDefined()
    expect(SSEChannelGroup.prototype.attachChannel).toBeDefined()

    expect(createSSEChannel).toBeDefined()
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

    const revokeDetail: RevokeEventDetail = { reason: 'manual' }
    const renewDetail: RenewEventDetail = { reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 }
    expect(revokeDetail.reason).toBe('manual')
    expect(renewDetail.reason).toBe('deadline')
    expect(renewDetail.maxAttempts).toBe(1)
    expect(renewDetail.retryDelayMs).toBe(250)
  })
})
