import type { PubSubAdapter } from '@/pubsub/core/index.js'
import type { InvalidateSignal } from '@/types/protocol.js'
import { isEnvelope, isSignalPayload } from '@/pubsub/core/pubsub-utils.js'

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
 */
export function redisPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: RedisClient,
  options?: { subscribeClient?: RedisClient }
): PubSubAdapter<TSignal> {
  const instanceId = Math.random().toString(36).slice(2)
  const subscribeClient = options?.subscribeClient || client.duplicate()

  // Delegate error handler to prevent Node crash on unhandled subscriber client error events
  let errorHandler: (err: unknown) => void = (err) => {
    console.warn('[WARN][redisPubSubAdapter] Unhandled redis subscription client error:', err)
  }

  subscribeClient.on('error', (err: unknown) => {
    errorHandler(err)
  })

  // Map of topic to the onMessage callback
  const callbacks = new Map<string, (signal: TSignal | TSignal[]) => void>()

  // Set up a single message listener on the subscription client
  subscribeClient.on('message', (channel: string, message: string) => {
    const onMessage = callbacks.get(channel)
    if (!onMessage) return

    try {
      const parsed: unknown = JSON.parse(message)
      if (isEnvelope(parsed)) {
        if (parsed.origin === instanceId) {
          // Suppress self-echo
          return
        }
        const payload = parsed.payload
        if (isSignalPayload<TSignal>(payload)) {
          onMessage(payload)
        }
      }
    } catch (err) {
      errorHandler(err)
    }
  })

  return {
    async publish(topic: string, signal: TSignal | TSignal[]): Promise<void> {
      const envelope = {
        origin: instanceId,
        payload: signal,
      }
      await client.publish(topic, JSON.stringify(envelope))
    },

    async subscribe(
      topic: string,
      onMessage: (signal: TSignal | TSignal[]) => void
    ): Promise<() => Promise<void>> {
      callbacks.set(topic, onMessage)
      await subscribeClient.subscribe(topic)

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
