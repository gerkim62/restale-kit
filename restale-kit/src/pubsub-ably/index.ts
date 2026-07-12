import type { PubSubAdapter } from '../server-core/channel-group.js'
import type { InvalidateSignal } from '../shared/types.js'
import { isEnvelope, isSignalPayload } from '../server-core/pubsub-utils.js'

/**
 * Minimal structural interface for an Ably Channel.
 */
export interface AblyChannel {
  publish(name: string, data: unknown): unknown
  subscribe(listener: (message: { data: unknown }) => void): unknown
  unsubscribe(listener: (message: { data: unknown }) => void): unknown
}

/**
 * Minimal structural interface for an Ably Client.
 */
export interface AblyClient {
  options?: {
    echoMessages?: boolean
  }
  connection?: {
    on(event: 'error', listener: (err: unknown) => void): unknown
  }
  channels: {
    get(name: string): AblyChannel
  }
}

/**
 * Creates a Pub/Sub adapter for Ably.
 *
 * @param client An AblyRealtime client instance.
 * @param options Configuration options.
 * @param options.useNativeEchoSuppression If true, the adapter skips envelope wrapping/parsing and relies on Ably client's native self-echo suppression. The Ably client must be instantiated with `echoMessages: false`.
 */
export function ablyPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: AblyClient,
  options?: { useNativeEchoSuppression?: boolean }
): PubSubAdapter<TSignal> {
  const instanceId = Math.random().toString(36).slice(2)
  const useNativeEchoSuppression = !!options?.useNativeEchoSuppression

  if (useNativeEchoSuppression) {
    const echoMessages = client.options?.echoMessages
    if (echoMessages !== false) {
      throw new Error(
        'Ably: echoMessages must be explicitly set to false on your Ably client when useNativeEchoSuppression is enabled.'
      )
    }
  }

  let errorHandler: (err: unknown) => void = (err) => {
    console.warn('[WARN][ablyPubSubAdapter] Unhandled ably connection/channel error:', err)
  }

  // Subscribe to connection errors if available
  if (client.connection && typeof client.connection.on === 'function') {
    client.connection.on('error', (err: unknown) => {
      errorHandler(err)
    })
  }

  return {
    async publish(topic: string, signal: TSignal | TSignal[]): Promise<void> {
      const channel = client.channels.get(topic)
      if (useNativeEchoSuppression) {
        await channel.publish('invalidate', signal)
      } else {
        const envelope = {
          origin: instanceId,
          payload: signal,
        }
        await channel.publish('invalidate', envelope)
      }
    },

    async subscribe(
      topic: string,
      onMessage: (signal: TSignal | TSignal[]) => void
    ): Promise<() => Promise<void>> {
      const channel = client.channels.get(topic)

      const listener = (message: { data: unknown }) => {
        try {
          const data = message.data
          if (useNativeEchoSuppression) {
            if (isSignalPayload<TSignal>(data)) {
              onMessage(data)
            }
          } else {
            if (isEnvelope(data)) {
              if (data.origin === instanceId) {
                // Suppress self-echo
                return
              }
              const payload = data.payload
              if (isSignalPayload<TSignal>(payload)) {
                onMessage(payload)
              }
            }
          }
        } catch (err) {
          errorHandler(err)
        }
      }

      await channel.subscribe(listener)

      return async () => {
        try {
          await channel.unsubscribe(listener)
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

