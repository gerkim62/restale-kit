import type { PubSubMessage, Signal } from '@/types/protocol.js'
import { isJSONValue, isCacheKey } from '@/types/protocol.js'

export function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function isValidSignal(value: unknown): value is Signal {
  if (!isObject(value) || !isCacheKey(value.key)) return false
  if ('inlineData' in value) {
    return isJSONValue(value.inlineData) && !('exact' in value) &&
      (!('markStale' in value) || typeof value.markStale === 'boolean')
  }
  return !('markStale' in value) && (!('exact' in value) || typeof value.exact === 'boolean')
}

export function isSignalPayload(val: unknown): val is Signal | Signal[] {
  return Array.isArray(val) ? val.length > 0 && val.every(isValidSignal) : isValidSignal(val)
}

export function isPubSubMessage(val: unknown): val is PubSubMessage {
  if (!isObject(val)) return false
  if (val.kind === 'signal') return isSignalPayload(val.data)
  if (val.kind === 'control') return isJSONValue(val.data)
  return val.kind === 'inlineData' && typeof val.topic === 'string' && isJSONValue(val.payload)
}

export interface Envelope { origin: string; payload: unknown }
export function isEnvelope(val: unknown): val is Envelope {
  return isObject(val) && typeof val.origin === 'string' && 'payload' in val
}

const WARN_THROTTLE_MS = 60_000
export function createDecryptionErrorHandler(adapterName: string) {
  let lastDecryptionErrorTime = 0
  return (err: unknown, topic: string): boolean => {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'PubSubDecryptionError') {
      if (Date.now() - lastDecryptionErrorTime > WARN_THROTTLE_MS) {
        lastDecryptionErrorTime = Date.now()
        console.warn(`[WARN][${adapterName}] Decryption failed for topic "${topic}".`, err)
      }
      return true
    }
    return false
  }
}
