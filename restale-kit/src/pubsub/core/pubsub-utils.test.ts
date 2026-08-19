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

  it('isPubSubMessage validates signal, control, and inlineData kind messages', () => {
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['items'] } })).toBe(true)
    expect(isPubSubMessage({ kind: 'control', data: { userId: 10 } })).toBe(true)
    expect(isPubSubMessage({ kind: 'inlineData', topic: 'users', payload: { id: 1 } })).toBe(true)

    expect(isPubSubMessage(null)).toBe(false)
    expect(isPubSubMessage(123)).toBe(false)
    expect(isPubSubMessage({ kind: 'unknown', data: {} })).toBe(false)
    expect(isPubSubMessage({ kind: 'control', data: Symbol('bad') })).toBe(false)
    expect(isPubSubMessage({ kind: 'inlineData', topic: 123, payload: { id: 1 } })).toBe(false)
    expect(isPubSubMessage({ kind: 'inlineData', topic: 'users', payload: Symbol('bad') })).toBe(false)
  })

  it('isSignalPayload validates single and batched universal signals', () => {
    expect(isSignalPayload({ key: ['a'] })).toBe(true)
    expect(isSignalPayload({ key: ['a'], exact: true })).toBe(true)
    expect(isSignalPayload({ key: ['a'], inlineData: { id: 1 } })).toBe(true)
    expect(isSignalPayload({ key: ['a'], inlineData: { id: 1 }, markStale: true })).toBe(true)
    expect(isSignalPayload([{ key: ['a'] }, { key: ['b'], exact: false }])).toBe(true)

    // Sad paths
    expect(isSignalPayload([])).toBe(false)
    expect(isSignalPayload(null)).toBe(false)
    expect(isSignalPayload({ key: 'not-array' })).toBe(false)
    expect(isSignalPayload({ key: ['a'], markStale: 'not-a-bool' })).toBe(false)
    expect(isSignalPayload({ key: ['a'], exact: 'not-a-bool' })).toBe(false)
    expect(isSignalPayload({ key: ['a'], inlineData: Symbol('bad') })).toBe(false)
    expect(isSignalPayload({ key: ['a'], inlineData: 1, exact: true })).toBe(false)
  })

  it('isEnvelope validates origin string and payload property', () => {
    expect(isEnvelope({ origin: 'inst-1', payload: { kind: 'control', data: {} } })).toBe(true)
    expect(isEnvelope(null)).toBe(false)
    expect(isEnvelope(123)).toBe(false)
    expect(isEnvelope({ origin: 123, payload: {} })).toBe(false)
    expect(isEnvelope({ origin: 'inst-1' })).toBe(false)
  })
})

