import type { PubSubAdapter, PubSubEncryptionOptions } from '@/pubsub/core/index.js'
import type { InvalidateSignal, PubSubMessage } from '@/types/protocol.js'
import { generateInstanceId } from '@/utils/id.js'
import { wrapEnvelope, unwrapEnvelope, validateEncryptionOptions } from '@/pubsub/core/envelope.js'
import { PUBSUB_EVENTS } from '@/utils/constants.js'
import { createDecryptionErrorHandler } from '@/pubsub/core/pubsub-utils.js'

/**
 * Minimal structural interface for the Pusher Webhook parsed result.
 */
export interface PusherWebhook {
  isValid(): boolean
  getEvents(): Array<{ channel: string; name: string; data: string | object }>
}

/**
 * Minimal structural interface for a Pusher Server client.
 */
export interface PusherClient {
  trigger(channel: string, event: string, data: unknown): unknown
  webhook(options: { headers: Record<string, string>; rawBody: string }): PusherWebhook
}

/**
 * Creates a Pub/Sub adapter for Pusher using a webhook-based subscription model.
 *
 * @param pusherServerClient A PusherClient instance (`pusher` on npm) used to trigger/publish events.
 * @param options Configuration options.
 * @param options Optional configuration options. Encryption is disabled by default.
 * @param options.encryptionKey Base64 or hex encoded key of 32+ bytes generated via CSPRNG (e.g. not human-chosen) to encrypt payloads sent to the provider.
 * @param options.encrypt Set to false to explicitly disable encryption. Exclusive with encryptionKey.
 */
export function pusherPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  pusherServerClient: PusherClient,
  options: PubSubEncryptionOptions = {}
): PubSubAdapter<TSignal> & {
  handleWebhook(body: string, headers: Record<string, string>): boolean
} {
  const { encryptionKey } = validateEncryptionOptions(options)
  const instanceId = generateInstanceId()

  let errorHandler: (err: unknown) => void = (err) => {
    console.warn('[WARN][pusherPubSubAdapter] Unhandled pusher error:', err)
  }

  // Map of topic (channel) to the active callback
  const callbacks = new Map<string, (message: PubSubMessage<TSignal>) => void>()

  const handleDecryptionError = createDecryptionErrorHandler('pusherPubSubAdapter')

  return {
    async publish(topic: string, message: PubSubMessage<TSignal>): Promise<void> {
      const eventName = message.kind === 'control' ? PUBSUB_EVENTS.CONTROL : PUBSUB_EVENTS.INVALIDATE
      const envelope = wrapEnvelope(instanceId, message, encryptionKey, topic)
      await pusherServerClient.trigger(topic, eventName, envelope)
    },

    subscribe(
      topic: string,
      onMessage: (message: PubSubMessage<TSignal>) => void
    ): Promise<() => void> {
      callbacks.set(topic, onMessage)
      return Promise.resolve(() => {
        callbacks.delete(topic)
      })
    },

    onError(handler: (error: unknown) => void): void {
      errorHandler = handler
    },

    /**
     * Helper to process incoming Pusher webhooks.
     * Parses the request, validates its cryptographic signature using the Pusher client secret,
     * and dispatches signals to the registered topic handlers.
     *
     * @param body The raw request body string.
     * @param headers The HTTP request headers (case-insensitive keys).
     * @returns `true` if the webhook signature was valid and processed; `false` otherwise.
     */
    handleWebhook(body: string, headers: Record<string, string>): boolean {
      try {
        const webhook = pusherServerClient.webhook({ headers, rawBody: body })
        if (!webhook.isValid()) {
          return false
        }

        const events = webhook.getEvents()
        for (const event of events) {
          if (event.name === PUBSUB_EVENTS.INVALIDATE || event.name === PUBSUB_EVENTS.CONTROL) {
            const onMessage = callbacks.get(event.channel)
            if (onMessage) {
              try {
                const unwrapped = unwrapEnvelope<TSignal>(event.data, instanceId, encryptionKey, event.channel)
                if (unwrapped) {
                  onMessage(unwrapped)
                }
              } catch (err) {
                if (handleDecryptionError(err, event.channel)) {
                  continue // Drop message and continue loop
                }
                errorHandler(err)
              }
            }
          }
        }
        return true
      } catch (err) {
        errorHandler(err)
        return false
      }
    },
  }
}


