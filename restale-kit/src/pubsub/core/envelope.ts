import type { InvalidateSignal, PubSubMessage } from '@/types/protocol.js'
import { isEnvelope, isPubSubMessage, isSignalPayload, isObject } from './pubsub-utils.js'
import crypto from 'node:crypto'

export class PubSubDecryptionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'PubSubDecryptionError'
  }
}

/** Standard envelope structure wrapping a PubSubMessage with origin metadata. */
export interface PubSubEnvelope<T extends InvalidateSignal = InvalidateSignal> {
  origin: string
  payload: PubSubMessage<T>
}

/**
 * Validates the pub/sub adapter options and extracts the encryption key.
 */
export function validateEncryptionOptions(options: unknown): { encryptionKey?: string } {
  if (!isObject(options)) {
    throw new Error('Pub/Sub adapter options are required. You must explicitly configure encryption: either pass encrypt: false or a valid encryptionKey.')
  }
  const hasEncrypt = 'encrypt' in options
  const hasKey = 'encryptionKey' in options

  if (!hasEncrypt && !hasKey) {
    throw new Error('Pub/Sub adapter options are required. You must explicitly configure encryption: either pass encrypt: false or a valid encryptionKey.')
  }

  if (hasEncrypt && options['encrypt'] === false) {
    if (hasKey) {
      throw new Error('Exclusive option error: encrypt: false and encryptionKey are mutually exclusive.')
    }
    return {}
  }

  if (hasEncrypt && options['encrypt'] !== true) {
    throw new Error('Invalid value for "encrypt": must be boolean false or true.')
  }

  const key = options['encryptionKey']
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('Invalid encryptionKey: must be a non-empty string.')
  }
  return { encryptionKey: key }
}

/**
 * Encrypts data using AES-256-GCM, with AAD binding.
 */
export function encryptPayload(data: unknown, encryptionKey: string, aad: string): string {
  if (!aad || typeof aad !== 'string' || aad.trim() === '') {
    throw new Error('AAD (topic) must be a non-empty string for encryption.')
  }
  const key = crypto.createHash('sha256').update(encryptionKey).digest()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  cipher.setAAD(Buffer.from(aad, 'utf8'))

  const plaintext = JSON.stringify(data)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag().toString('hex')

  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Decrypts data using AES-256-GCM, with AAD verification.
 */
export function decryptPayload(encryptedString: string, encryptionKey: string, aad: string): unknown {
  if (!aad || typeof aad !== 'string' || aad.trim() === '') {
    throw new Error('AAD (topic) must be a non-empty string for decryption.')
  }
  const parts = encryptedString.split(':')
  if (parts.length !== 3) {
    throw new PubSubDecryptionError('Invalid encrypted payload format.')
  }

  const [ivHex, authTagHex, encryptedHex] = parts
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new PubSubDecryptionError('Invalid encrypted payload format parts.')
  }

  try {
    const key = crypto.createHash('sha256').update(encryptionKey).digest()
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return JSON.parse(decrypted)
  } catch (err) {
    throw new PubSubDecryptionError('Decryption failed (bad auth tag or corrupted payload).', err)
  }
}

/**
 * Wraps a message into a serializable envelope payload.
 */
export function wrapEnvelope<T extends InvalidateSignal>(
  originId: string,
  message: PubSubMessage<T>,
  encryptionKey?: string,
  topic?: string
): { origin: string; payload: unknown } {
  if (encryptionKey) {
    if (!topic || typeof topic !== 'string' || topic.trim() === '') {
      throw new Error('Topic is required for encryption AAD binding.')
    }
    const encrypted = encryptPayload(message, encryptionKey, topic)
    return { origin: originId, payload: encrypted }
  }
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
  localOriginId: string,
  encryptionKey?: string,
  topic?: string
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

  let payload = parsed.payload
  if (encryptionKey) {
    if (!topic || typeof topic !== 'string' || topic.trim() === '') {
      throw new Error('Topic is required for decryption AAD binding.')
    }
    if (typeof payload !== 'string') {
      throw new PubSubDecryptionError('Expected encrypted payload to be a string.')
    }
    payload = decryptPayload(payload, encryptionKey, topic)
  }

  if (isPubSubMessage<T>(payload)) {
    return payload
  }
  if (isSignalPayload<T>(payload)) {
    return { kind: 'signal', data: payload }
  }
  return null
}

