import { describe, it, expect } from 'vitest'
import {
  wrapEnvelope,
  unwrapEnvelope,
  validateEncryptionOptions,
  encryptPayload,
  decryptPayload,
  PubSubDecryptionError
} from './envelope.js'

describe('pubsub envelope & encryption', () => {
  describe('validateEncryptionOptions', () => {
    it('accepts encrypt: false', () => {
      expect(validateEncryptionOptions({ encrypt: false })).toEqual({})
    })

    it('accepts valid encryptionKey', () => {
      expect(validateEncryptionOptions({ encryptionKey: 'my-secret-key' })).toEqual({
        encryptionKey: 'my-secret-key',
      })
    })

    it('accepts encrypt: true and valid encryptionKey', () => {
      expect(validateEncryptionOptions({ encrypt: true, encryptionKey: 'my-secret-key' })).toEqual({
        encryptionKey: 'my-secret-key',
      })
    })

    it('throws correct message for empty options', () => {
      expect(() => validateEncryptionOptions({})).toThrow(
        'Pub/Sub adapter options are required. You must explicitly configure encryption: either pass encrypt: false or a valid encryptionKey.'
      )
      expect(() => validateEncryptionOptions(null)).toThrow(
        'Pub/Sub adapter options are required. You must explicitly configure encryption: either pass encrypt: false or a valid encryptionKey.'
      )
    })

    it('throws correct message for blank key', () => {
      expect(() => validateEncryptionOptions({ encryptionKey: '   ' })).toThrow(
        'Invalid encryptionKey: must be a non-empty string.'
      )
    })

    it('throws for mutual exclusivity', () => {
      expect(() => validateEncryptionOptions({ encrypt: false, encryptionKey: 'some' })).toThrow(
        'Exclusive option error: encrypt: false and encryptionKey are mutually exclusive.'
      )
    })

    it('throws for invalid encrypt value', () => {
      expect(() => validateEncryptionOptions({ encrypt: 'invalid' })).toThrow(
        'Invalid value for "encrypt": must be boolean false or true.'
      )
    })

    it('throws for encrypt: true without key', () => {
      expect(() => validateEncryptionOptions({ encrypt: true })).toThrow(
        'Invalid encryptionKey: must be a non-empty string.'
      )
    })
  })

  describe('encryptPayload and decryptPayload', () => {
    const key = 'secret-passphrase'
    const topic = 'my-topic'
    const data = { kind: 'signal' as const, data: { key: ['todos'] } }

    it('successfully encrypts and decrypts with the same key and topic', () => {
      const encrypted = encryptPayload(data, key, topic)
      expect(encrypted).not.toContain('todos')

      const decrypted = decryptPayload(encrypted, key, topic)
      expect(decrypted).toEqual(data)
    })

    it('throws PubSubDecryptionError on key mismatch (simulating key rotation)', () => {
      const encrypted = encryptPayload(data, key, topic)
      expect(() => decryptPayload(encrypted, 'wrong-key', topic)).toThrow(PubSubDecryptionError)
    })

    it('throws PubSubDecryptionError on topic mismatch (AAD binding validation)', () => {
      const encrypted = encryptPayload(data, key, topic)
      expect(() => decryptPayload(encrypted, key, 'wrong-topic')).toThrow(PubSubDecryptionError)
    })

    it('throws PubSubDecryptionError on tampered ciphertext', () => {
      const encrypted = encryptPayload(data, key, topic)
      const parts = encrypted.split(':')
      parts[2] = parts[2].substring(0, parts[2].length - 2) + '00' // tamper ciphertext
      const tampered = parts.join(':')
      expect(() => decryptPayload(tampered, key, topic)).toThrow(PubSubDecryptionError)
    })
  })

  describe('wrapEnvelope and unwrapEnvelope', () => {
    it('wrapEnvelope constructs serializable envelope object without encryption', () => {
      const message = { kind: 'signal' as const, data: { key: ['todos'] } }
      const env = wrapEnvelope('inst-100', message)

      expect(env).toEqual({
        origin: 'inst-100',
        payload: message,
      })
    })

    it('wrapEnvelope encrypts payload when key is provided', () => {
      const message = { kind: 'signal' as const, data: { key: ['todos'] } }
      const env = wrapEnvelope('inst-100', message, 'my-key', 'my-topic')

      expect(env.origin).toBe('inst-100')
      expect(typeof env.payload).toBe('string')
      expect(env.payload).not.toContain('todos')
    })

    it('wrapEnvelope throws if key is provided but topic is missing/empty', () => {
      const message = { kind: 'signal' as const, data: { key: ['todos'] } }
      expect(() => wrapEnvelope('inst-100', message, 'my-key')).toThrow(
        'Topic is required for encryption AAD binding.'
      )
    })

    it('unwrapEnvelope throws if key is provided but topic is missing/empty', () => {
      expect(() => unwrapEnvelope({ origin: 'other', payload: 'enc' }, 'my-origin', 'my-key')).toThrow(
        'Topic is required for decryption AAD binding.'
      )
    })

    it('unwrapEnvelope returns null on invalid JSON string syntax', () => {
      const result = unwrapEnvelope('{ invalid json payload', 'my-origin')
      expect(result).toBeNull()
    })

    it('unwrapEnvelope returns null when message is self-echoed from localOriginId', () => {
      const env = { origin: 'my-origin', payload: { kind: 'signal', data: { key: ['a'] } } }
      const result = unwrapEnvelope(JSON.stringify(env), 'my-origin')
      expect(result).toBeNull()
    })

    it('unwraps valid PubSubMessage envelope from remote origin without encryption', () => {
      const env = { origin: 'other-origin', payload: { kind: 'control', data: { userId: 5 } } }
      const result = unwrapEnvelope(JSON.stringify(env), 'my-origin')
      expect(result).toEqual({ kind: 'control', data: { userId: 5 } })
    })

    it('unwraps and decrypts encrypted envelope', () => {
      const message = { kind: 'signal' as const, data: { key: ['todos'] } }
      const env = wrapEnvelope('other-origin', message, 'key', 'topic')
      const result = unwrapEnvelope(env, 'my-origin', 'key', 'topic')
      expect(result).toEqual(message)
    })

    it('normalizes legacy signal payload into signal PubSubMessage', () => {
      const env = { origin: 'other-origin', payload: { key: ['legacy-key'] } }
      const result = unwrapEnvelope(env, 'my-origin')
      expect(result).toEqual({ kind: 'signal', data: { key: ['legacy-key'] } })
    })

    it('returns null on invalid envelope structure', () => {
      expect(unwrapEnvelope({ foo: 'bar' }, 'my-origin')).toBeNull()
    })

    it('returns null when envelope payload is neither a valid PubSubMessage nor InvalidateSignal', () => {
      const env = { origin: 'other-origin', payload: { invalidPayload: true } }
      expect(unwrapEnvelope(env, 'my-origin')).toBeNull()
    })
  })
})

