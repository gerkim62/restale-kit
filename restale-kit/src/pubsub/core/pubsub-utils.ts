import type { InvalidateSignal, PubSubMessage } from '@/types/protocol.js'
import { isJSONValue } from '@/types/protocol.js'

/**
 * Type guard to check if a value is a non-null object.
 */
export function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Type guard to check if a value is a valid invalidation signal or array of signals.
 */
export function isSignalPayload<T extends InvalidateSignal>(val: unknown): val is T | T[] {
  if (Array.isArray(val)) {
    for (const item of val) {
      if (!isObject(item) || !Array.isArray(item['key'])) {
        return false
      }
    }
    return true
  }
  return isObject(val) && Array.isArray(val['key'])
}

/**
 * Type guard to check if a value is a valid PubSubMessage envelope.
 */
export function isPubSubMessage<T extends InvalidateSignal>(val: unknown): val is PubSubMessage<T> {
  if (!isObject(val)) return false
  if (val['kind'] === 'signal') {
    return isSignalPayload<T>(val['data'])
  }
  if (val['kind'] === 'control') {
    return isJSONValue(val['data'])
  }
  return false
}

/**
 * Interface representing a standard Pub/Sub envelope.
 */
export interface Envelope {
  origin: string
  payload: unknown
}

/**
 * Type guard to check if a value is a valid pub/sub envelope.
 */
export function isEnvelope(val: unknown): val is Envelope {
  if (!isObject(val)) return false
  return typeof val['origin'] === 'string' && 'payload' in val
}

const WARN_THROTTLE_MS = 60_000 // 1 minute

/**
 * Creates a rate-limited decryption error handler for Pub/Sub adapters.
 * Returns a function that handles PubSubDecryptionError instances by throttling warnings to once per minute.
 */
export function createDecryptionErrorHandler(adapterName: string) {
  let lastDecryptionErrorTime = 0

  return (err: unknown, topic: string): boolean => {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'PubSubDecryptionError') {
      const now = Date.now()
      if (now - lastDecryptionErrorTime > WARN_THROTTLE_MS) {
        lastDecryptionErrorTime = now
        console.warn(
          `[WARN][${adapterName}] Decryption failed for topic "${topic}". ` +
            'This may indicate a key mismatch (due to key rotation) or tampered payloads. ' +
            'Further warnings will be throttled for 1 minute.',
          err
        )
      }
      return true
    }
    return false
  }
}


