import { describe, it, expect } from 'vitest'
import { isObject, isPubSubMessage, isEnvelope } from './pubsub-utils.js'

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
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], exact: true } })).toBe(true)
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], inlineData: { id: 1 } } })).toBe(true)
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], inlineData: { id: 1 }, markStale: true } })).toBe(true)
    expect(isPubSubMessage({ kind: 'signal', data: [{ key: ['a'] }, { key: ['b'], exact: false }] })).toBe(true)
    expect(isPubSubMessage({ kind: 'control', data: { userId: 10 } })).toBe(true)
    expect(isPubSubMessage({ kind: 'inlineData', topic: 'users', payload: { id: 1 } })).toBe(true)

    // Sad paths
    expect(isPubSubMessage(null)).toBe(false)
    expect(isPubSubMessage(123)).toBe(false)
    expect(isPubSubMessage({ kind: 'unknown', data: {} })).toBe(false)
    expect(isPubSubMessage({ kind: 'control', data: Symbol('bad') })).toBe(false)
    expect(isPubSubMessage({ kind: 'inlineData', topic: 123, payload: { id: 1 } })).toBe(false)
    expect(isPubSubMessage({ kind: 'inlineData', topic: 'users', payload: Symbol('bad') })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: [] })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: null })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: { key: 'not-array' } })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], markStale: 'not-a-bool' } })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], exact: 'not-a-bool' } })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], inlineData: Symbol('bad') } })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], inlineData: 1, exact: true } })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], target: 'swr' } })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], markStale: true } })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], inlineData: 1, extraField: 'unsupported' } })).toBe(false)
    expect(isPubSubMessage({ kind: 'signal', data: { key: ['a'], exact: true, extraField: 'unsupported' } })).toBe(false)
  })

  it('isEnvelope validates origin string and payload property', () => {
    expect(isEnvelope({ origin: 'inst-1', payload: { kind: 'control', data: {} } })).toBe(true)
    expect(isEnvelope(null)).toBe(false)
    expect(isEnvelope(123)).toBe(false)
    expect(isEnvelope({ origin: 123, payload: {} })).toBe(false)
    expect(isEnvelope({ origin: 'inst-1' })).toBe(false)
  })
})

