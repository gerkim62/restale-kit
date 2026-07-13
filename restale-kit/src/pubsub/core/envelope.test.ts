import { describe, it, expect } from 'vitest'
import { wrapEnvelope, unwrapEnvelope } from './envelope.js'

describe('pubsub envelope', () => {
  it('wrapEnvelope constructs serializable envelope object', () => {
    const message = { kind: 'signal' as const, data: { key: ['todos'] } }
    const env = wrapEnvelope('inst-100', message)

    expect(env).toEqual({
      origin: 'inst-100',
      payload: message,
    })
  })

  describe('unwrapEnvelope', () => {
    it('returns null on invalid JSON string syntax', () => {
      const result = unwrapEnvelope('{ invalid json payload', 'my-origin')
      expect(result).toBeNull()
    })

    it('returns null when message is self-echoed from localOriginId', () => {
      const env = { origin: 'my-origin', payload: { kind: 'signal', data: { key: ['a'] } } }
      const result = unwrapEnvelope(JSON.stringify(env), 'my-origin')
      expect(result).toBeNull()
    })

    it('unwraps valid PubSubMessage envelope from remote origin', () => {
      const env = { origin: 'other-origin', payload: { kind: 'control', data: { userId: 5 } } }
      const result = unwrapEnvelope(JSON.stringify(env), 'my-origin')
      expect(result).toEqual({ kind: 'control', data: { userId: 5 } })
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
