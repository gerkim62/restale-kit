import type { PubSubAdapter, PubSubEncryptionOptions } from '@/pubsub/core/index.js'
import type { InvalidateSignal, PubSubMessage } from '@/types/protocol.js'
import { createDecryptionErrorHandler } from '@/pubsub/core/pubsub-utils.js'
import { generateInstanceId } from '@/utils/id.js'
import { wrapEnvelope, unwrapEnvelope, validateEncryptionOptions } from '@/pubsub/core/envelope.js'

/**
 * Minimal structural interface for a Redis client (compatible with ioredis and node-redis).
 */
export interface RedisClient {
  publish(topic: string, message: string): unknown
  subscribe(topic: string): unknown
  unsubscribe(topic: string): unknown
  duplicate(): RedisClient
  on(event: 'error', listener: (err: unknown) => void): unknown
  on(event: 'message', listener: (channel: string, message: string) => void): unknown
}

/**
 * Creates a Pub/Sub adapter for Redis.
 *
 * @param client A RedisClient instance used for publishing.
 * @param options Configuration options.
 * @param options.subscribeClient An optional separate client instance to handle subscriptions. If omitted, `client.duplicate()` is called automatically.
 * @param options.encryptionKey Base64 or hex encoded key of 32+ bytes generated via CSPRNG (e.g. not human-chosen) to encrypt payloads sent to the provider.
 * @param options.encrypt If false, encryption is disabled. Exclusive with encryptionKey.
 */
export function redisPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: RedisClient,
  options: { subscribeClient?: RedisClient } & PubSubEncryptionOptions
): PubSubAdapter<TSignal> {
  const { encryptionKey } = validateEncryptionOptions(options)
  const instanceId = generateInstanceId()
  const subscribeClient = options.subscribeClient || client.duplicate()

  // Delegate error handler to prevent Node crash on unhandled subscriber client error events
  let errorHandler: (err: unknown) => void = (err) => {
    console.warn('[WARN][redisPubSubAdapter] Unhandled redis subscription client error:', err)
  }

  subscribeClient.on('error', (err: unknown) => {
    errorHandler(err)
  })

  // Map of topic to the onMessage callback
  const callbacks = new Map<string, (message: PubSubMessage<TSignal>) => void>()

  const handleDecryptionError = createDecryptionErrorHandler('redisPubSubAdapter')

  // Set up a single message listener on the subscription client
  subscribeClient.on('message', (channel: string, message: string) => {
    const onMessage = callbacks.get(channel)
    if (!onMessage) return

    try {
      const unwrapped = unwrapEnvelope<TSignal>(message, instanceId, encryptionKey, channel)
      if (unwrapped) {
        onMessage(unwrapped)
      }
    } catch (err) {
      if (handleDecryptionError(err, channel)) {
        return // Drop message and continue
      }
      errorHandler(err)
    }
  })

  return {
    async publish(topic: string, message: PubSubMessage<TSignal>): Promise<void> {
      const envelope = wrapEnvelope(instanceId, message, encryptionKey, topic)
      await client.publish(topic, JSON.stringify(envelope))
    },

    async subscribe(
      topic: string,
      onMessage: (message: PubSubMessage<TSignal>) => void
    ): Promise<() => Promise<void>> {
      if (callbacks.has(topic)) {
        throw new Error(
          `[redisPubSubAdapter] Topic "${topic}" is already subscribed. ` +
          'Unsubscribe the existing subscription before subscribing again. ' +
          'Subscribing twice to the same topic would silently drop the first callback.'
        )
      }
      callbacks.set(topic, onMessage)
      try {
        await subscribeClient.subscribe(topic)
      } catch (err) {
        // Roll back the callback registration so the caller can retry cleanly.
        callbacks.delete(topic)
        throw err
      }

      return async () => {
        callbacks.delete(topic)
        try {
          await subscribeClient.unsubscribe(topic)
        } catch (err) {
          errorHandler(err)
          throw err
        }
      }
    },

    onError(handler: (error: unknown) => void): void {
      errorHandler = handler
    },
  }
}



