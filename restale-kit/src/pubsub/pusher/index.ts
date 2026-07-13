import type { PubSubAdapter } from '../core/index.js'
import type { InvalidateSignal } from '../../types/protocol.js'
import { isEnvelope, isSignalPayload } from '../core/pubsub-utils.js'

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
 */
export function pusherPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  pusherServerClient: PusherClient
): PubSubAdapter<TSignal> & {
  handleWebhook(body: string, headers: Record<string, string>): boolean
} {
  const instanceId = Math.random().toString(36).slice(2)

  let errorHandler: (err: unknown) => void = (err) => {
    console.warn('[WARN][pusherPubSubAdapter] Unhandled pusher error:', err)
  }

  // Map of topic (channel) to the active callback
  const callbacks = new Map<string, (signal: TSignal | TSignal[]) => void>()

  return {
    async publish(topic: string, signal: TSignal | TSignal[]): Promise<void> {
      const envelope = {
        origin: instanceId,
        payload: signal,
      }
      await pusherServerClient.trigger(topic, 'invalidate', envelope)
    },

    subscribe(
      topic: string,
      onMessage: (signal: TSignal | TSignal[]) => void
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
          if (event.name === 'invalidate') {
            const onMessage = callbacks.get(event.channel)
            if (onMessage) {
              try {
                const data = event.data
                const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : data
                if (isEnvelope(parsed)) {
                  if (parsed.origin === instanceId) {
                    // Suppress self-echo
                    continue
                  }
                  const payload = parsed.payload
                  if (isSignalPayload<TSignal>(payload)) {
                    onMessage(payload)
                  }
                }
              } catch (err) {
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
