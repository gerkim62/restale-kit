import type { InvalidateSignal, PubSubMessage } from '@/types/protocol.js'
import { isEnvelope, isPubSubMessage, isSignalPayload } from './pubsub-utils.js'

/** Standard envelope structure wrapping a PubSubMessage with origin metadata. */
export interface PubSubEnvelope<T extends InvalidateSignal = InvalidateSignal> {
  origin: string
  payload: PubSubMessage<T>
}

/**
 * Wraps a message into a serializable envelope payload.
 */
export function wrapEnvelope<T extends InvalidateSignal>(
  originId: string,
  message: PubSubMessage<T>
): PubSubEnvelope<T> {
  return { origin: originId, payload: message }
}

/**
 * Unwraps raw pub/sub message payload.
 *
 * - Returns `null` if the message is malformed or self-echoed from `localOriginId`.
 * - Unwraps and normalizes legacy signal payloads into a `PubSubMessage<T>`.
 */
export function unwrapEnvelope<T extends InvalidateSignal>(
  rawData: unknown,
  localOriginId: string
): PubSubMessage<T> | null {
  let parsed: unknown = rawData
  if (typeof rawData === 'string') {
    try {
      parsed = JSON.parse(rawData)
    } catch {
      return null
    }
  }
  if (!isEnvelope(parsed)) return null
  if (parsed.origin === localOriginId) return null // Suppress self-echo

  const payload = parsed.payload
  if (isPubSubMessage<T>(payload)) {
    return payload
  }
  if (isSignalPayload<T>(payload)) {
    return { kind: 'signal', data: payload }
  }
  return null
}
