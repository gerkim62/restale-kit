import type { PubSubAdapter, PubSubEncryptionOptions } from '@/pubsub/core/index.js'
import { PubSubDecryptionError } from '@/pubsub/core/index.js'
import type { InvalidateSignal, PubSubMessage } from '@/types/protocol.js'
import { isPubSubMessage, isSignalPayload } from '@/pubsub/core/pubsub-utils.js'
import { generateInstanceId } from '@/utils/id.js'
import {
  wrapEnvelope,
  unwrapEnvelope,
  validateEncryptionOptions,
  encryptPayload,
  decryptPayload
} from '@/pubsub/core/envelope.js'

/**
 * Minimal structural interface for an Ably Channel.
 */
export interface AblyChannel {
  publish(name: string, data: unknown): unknown
  subscribe(listener: (message: { data: unknown }) => void): unknown
  unsubscribe(listener: (message: { data: unknown }) => void): unknown
  on?(event: string, listener: (stateChange: { reason?: unknown }) => void): unknown
  off?(event: string, listener: (stateChange: { reason?: unknown }) => void): unknown
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
 * @param options.encryptionKey Base64 or hex encoded key of 32+ bytes generated via CSPRNG (e.g. not human-chosen) to encrypt payloads sent to the provider.
 * @param options.encrypt If false, encryption is disabled. Exclusive with encryptionKey.
 */
export function ablyPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  client: AblyClient,
  options: { useNativeEchoSuppression?: boolean } & PubSubEncryptionOptions
): PubSubAdapter<TSignal> {
  const { encryptionKey } = validateEncryptionOptions(options)
  const instanceId = generateInstanceId()
  const useNativeEchoSuppression = !!options.useNativeEchoSuppression

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

  let lastDecryptionErrorTime = 0
  const WARN_THROTTLE_MS = 60000 // 1 minute

  return {
    async publish(topic: string, message: PubSubMessage<TSignal>): Promise<void> {
      const channel = client.channels.get(topic)
      if (useNativeEchoSuppression) {
        if (encryptionKey) {
          const encrypted = encryptPayload(message, encryptionKey, topic)
          await channel.publish('invalidate', encrypted)
        } else {
          await channel.publish('invalidate', message)
        }
      } else {
        const envelope = wrapEnvelope(instanceId, message, encryptionKey, topic)
        await channel.publish('invalidate', envelope)
      }
    },

    async subscribe(
      topic: string,
      onMessage: (message: PubSubMessage<TSignal>) => void
    ): Promise<() => Promise<void>> {
      const channel = client.channels.get(topic)

      const listener = (msg: { data: unknown }) => {
        try {
          const data = msg.data
          if (useNativeEchoSuppression) {
            let payload = data
            if (encryptionKey) {
              if (typeof data !== 'string') {
                throw new PubSubDecryptionError('Expected encrypted payload to be a string.')
              }
              payload = decryptPayload(data, encryptionKey, topic)
            }
            if (isPubSubMessage<TSignal>(payload)) {
              onMessage(payload)
            } else if (isSignalPayload<TSignal>(payload)) {
              onMessage({ kind: 'signal', data: payload })
            }
          } else {
            const unwrapped = unwrapEnvelope<TSignal>(data, instanceId, encryptionKey, topic)
            if (unwrapped) {
              onMessage(unwrapped)
            }
          }
        } catch (err) {
          if (err instanceof PubSubDecryptionError) {
            const now = Date.now()
            if (now - lastDecryptionErrorTime > WARN_THROTTLE_MS) {
              lastDecryptionErrorTime = now
              console.warn(
                `[WARN][ablyPubSubAdapter] Decryption failed for topic "${topic}". ` +
                'This may indicate a key mismatch (due to key rotation) or tampered payloads. ' +
                'Further warnings will be throttled for 1 minute.',
                err
              )
            }
            return // Drop message and continue
          }
          errorHandler(err)
        }
      }

      let stateListener: ((stateChange: { reason?: unknown }) => void) | undefined
      if (typeof channel.on === 'function') {
        stateListener = (stateChange: { reason?: unknown }) => {
          if (stateChange.reason) {
            errorHandler(stateChange.reason)
          }
        }
        channel.on('failed', stateListener)
        channel.on('update', stateListener)
      }

      await channel.subscribe(listener)

      return async () => {
        try {
          if (stateListener && typeof channel.off === 'function') {
            channel.off('failed', stateListener)
            channel.off('update', stateListener)
          }
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



