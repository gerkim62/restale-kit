import { describe, it, expect } from 'vitest'
import {
  isJSONValue,
  isJSONValueArray,
  matchesInvalidateSignalKey,
  matchesJSONValue,
} from './protocol.js'

describe('protocol - isJSONValue', () => {
  it('recognizes valid primitives', () => {
    expect(isJSONValue('hello')).toBe(true)
    expect(isJSONValue(42)).toBe(true)
    expect(isJSONValue(0)).toBe(true)
    expect(isJSONValue(-1.5)).toBe(true)
    expect(isJSONValue(true)).toBe(true)
    expect(isJSONValue(false)).toBe(true)
    expect(isJSONValue(null)).toBe(true)
  })

  it('rejects non-finite numbers', () => {
    expect(isJSONValue(NaN)).toBe(false)
    expect(isJSONValue(Infinity)).toBe(false)
    expect(isJSONValue(-Infinity)).toBe(false)
  })

  it('rejects non-serializable primitives', () => {
    expect(isJSONValue(undefined)).toBe(false)
    expect(isJSONValue(Symbol('test'))).toBe(false)
    expect(isJSONValue(BigInt(100))).toBe(false)
    expect(isJSONValue(() => {})).toBe(false)
  })

  it('recognizes valid nested structures', () => {
    expect(isJSONValue(['todos', 1, { status: 'active', flags: [true, null] }])).toBe(true)
  })

  it('rejects class instances and invalid properties', () => {
    expect(isJSONValue(new Date())).toBe(false)
    expect(isJSONValue(new Set())).toBe(false)
    expect(isJSONValue(new Map())).toBe(false)
    expect(isJSONValue({ fn: () => {} })).toBe(false)
    expect(isJSONValue([undefined])).toBe(false)
  })
})

describe('protocol - isJSONValueArray', () => {
  it('validates array of JSON values', () => {
    expect(isJSONValueArray(['users', { id: 10 }])).toBe(true)
    expect(isJSONValueArray('not-an-array')).toBe(false)
    expect(isJSONValueArray(['users', undefined])).toBe(false)
  })
})

describe('protocol - matchesInvalidateSignalKey & matchesJSONValue', () => {
  it('matches exact array signal keys', () => {
    const signal = { key: ['users', 1], exact: true }
    expect(matchesInvalidateSignalKey(['users', 1], signal)).toBe(true)
    expect(matchesInvalidateSignalKey(['users', 1, 'details'], signal)).toBe(false)
    expect(matchesInvalidateSignalKey(['users'], signal)).toBe(false)
  })

  it('matches prefix array signal keys', () => {
    const signal = { key: ['users', 1] } // exact defaults to false/undefined
    expect(matchesInvalidateSignalKey(['users', 1], signal)).toBe(true)
    expect(matchesInvalidateSignalKey(['users', 1, 'posts'], signal)).toBe(true)
    expect(matchesInvalidateSignalKey(['users'], signal)).toBe(false)
  })

  it('handles object property matching', () => {
    const signal = { key: ['todos', { filter: 'active' }], exact: false }
    expect(matchesInvalidateSignalKey(['todos', { filter: 'active', page: 1 }], signal)).toBe(true)
    expect(matchesInvalidateSignalKey(['todos', { filter: 'completed', page: 1 }], signal)).toBe(false)
  })

  it('exact signal requires structural equality on object properties', () => {
    const signalExact = { key: ['todos', { filter: 'active' }], exact: true }
    expect(matchesInvalidateSignalKey(['todos', { filter: 'active', page: 1 }], signalExact)).toBe(false)
    expect(matchesInvalidateSignalKey(['todos', { filter: 'active' }], signalExact)).toBe(true)
  })

  it('returns false for invalid cache keys', () => {
    const signal = { key: ['users'] }
    expect(matchesInvalidateSignalKey(null, signal)).toBe(false)
    expect(matchesInvalidateSignalKey('users', signal)).toBe(false)
    expect(matchesInvalidateSignalKey([new Date()], signal)).toBe(false)
  })

  it('handles primitive type mismatches in matchesJSONValue', () => {
    expect(matchesJSONValue('foo', 'bar', false)).toBe(false)
    expect(matchesJSONValue(123, null, false)).toBe(false)
    expect(matchesJSONValue(null, 123, false)).toBe(false)
    expect(matchesJSONValue([1, 2], { 0: 1 }, false)).toBe(false)
  })
})
