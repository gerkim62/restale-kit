import { describe, it, expect } from 'vitest'
import { isObject, isSignalPayload, isPubSubMessage, isEnvelope } from './pubsub-utils.js'

describe('pubsub-utils', () => {
  it('isObject checks plain object status correctly', () => {
    expect(isObject({})).toBe(true)
    expect(isObject({ a: 1 })).toBe(true)
    expect(isObject(null)).toBe(false)
    expect(isObject([])).toBe(false)
    expect(isObject('string')).toBe(false)
  })

  it('isSignalPayload validates single signal and array batch', () => {
    expect(isSignalPayload({ key: ['todos'] })).toBe(true)
    expect(isSignalPayload([{ key: ['todos'] }, { key: ['users'] }])).toBe(true)

    expect(isSignalPayload({ key: 'not-an-array' })).toBe(false)
    expect(isSignalPayload([{ key: ['valid'] }, { invalid: true }])).toBe(false)
  })

  it('isPubSubMessage validates signal and control kind messages', () => {
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['items'] } })).toBe(true)
    expect(isPubSubMessage({ kind: 'control', data: { userId: 10 } })).toBe(true)

    expect(isPubSubMessage(null)).toBe(false)
    expect(isPubSubMessage(123)).toBe(false)
    expect(isPubSubMessage({ kind: 'unknown', data: {} })).toBe(false)
    expect(isPubSubMessage({ kind: 'control', data: Symbol('bad') })).toBe(false)
  })

  it('isEnvelope validates origin string and payload property', () => {
    expect(isEnvelope({ origin: 'inst-1', payload: { kind: 'control', data: {} } })).toBe(true)
    expect(isEnvelope(null)).toBe(false)
    expect(isEnvelope(123)).toBe(false)
    expect(isEnvelope({ origin: 123, payload: {} })).toBe(false)
    expect(isEnvelope({ origin: 'inst-1' })).toBe(false)
  })
})
