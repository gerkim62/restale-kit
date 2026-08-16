import { describe, it, expect } from 'vitest'
import { validatePayload } from '@/client/core/validation.js'
import { validateSignalPayload } from '@/server/core/channel.js'

interface ValidationFixture {
  description: string
  input: unknown
  shouldPass: boolean
}

describe('Signal shape validation (client/server parity)', () => {
  const fixtures: ValidationFixture[] = [
    // --- Accepted fixtures ---
    {
      description: 'empty key array { key: [] } (documented valid decision)',
      input: { key: [] },
      shouldPass: true,
    },
    {
      description: 'standard revalidate signal { key: ["a"] }',
      input: { key: ['a'] },
      shouldPass: true,
    },
    {
      description: 'revalidate signal with exact: true',
      input: { key: ['a'], exact: true },
      shouldPass: true,
    },
    {
      description: 'revalidate signal with exact: false',
      input: { key: ['a'], exact: false },
      shouldPass: true,
    },
    {
      description: 'standard inline-data signal',
      input: { key: ['a'], inlineData: { id: 1 } },
      shouldPass: true,
    },
    {
      description: 'inline-data signal with markStale: true',
      input: { key: ['a'], inlineData: { id: 1 }, markStale: true },
      shouldPass: true,
    },
    {
      description: 'inline-data signal with markStale: false',
      input: { key: ['a'], inlineData: { id: 1 }, markStale: false },
      shouldPass: true,
    },
    {
      description: 'inline-data signal with null payload',
      input: { key: ['a'], inlineData: null },
      shouldPass: true,
    },
    {
      description: 'string containing null byte { key: ["\\u0000"] }',
      input: { key: ['\u0000'] },
      shouldPass: true,
    },
    {
      description: 'very long string in key (10k+ characters)',
      input: { key: ['x'.repeat(10_000)] },
      shouldPass: true,
    },
    {
      description: 'key containing null-prototype object { key: [Object.create(null)] }',
      input: { key: [Object.create(null)] },
      shouldPass: true,
    },

    // --- Rejected fixtures ---
    {
      description: 'residual removed field { key: ["a"], target: "swr" }',
      input: { key: ['a'], target: 'swr' },
      shouldPass: false,
    },
    {
      description: 'mixed signal arms { key: ["a"], inlineData: 1, exact: true }',
      input: { key: ['a'], inlineData: 1, exact: true },
      shouldPass: false,
    },
    {
      description: 'markStale without inlineData { key: ["a"], markStale: true }',
      input: { key: ['a'], markStale: true },
      shouldPass: false,
    },
    {
      description: 'numeric NaN in key { key: [NaN] }',
      input: { key: [NaN] },
      shouldPass: false,
    },
    {
      description: 'numeric Infinity in key { key: [Infinity] }',
      input: { key: [Infinity] },
      shouldPass: false,
    },
    {
      description: 'numeric -Infinity in key { key: [-Infinity] }',
      input: { key: [-Infinity] },
      shouldPass: false,
    },
    {
      description: 'prototype pollution in key object { key: [{ __proto__: { polluted: true } }] }',
      input: { key: [{ __proto__: { polluted: true } }] },
      shouldPass: false,
    },
    {
      description: 'custom prototype object in key { key: [Object.create({ custom: "proto" })] }',
      input: { key: [Object.create({ custom: 'proto' })] },
      shouldPass: false,
    },
    {
      description: 'inlineData set to undefined { key: ["a"], inlineData: undefined }',
      input: { key: ['a'], inlineData: undefined },
      shouldPass: false,
    },
    {
      description: 'non-JSON Date instance in key { key: [new Date()] }',
      input: { key: [new Date()] },
      shouldPass: false,
    },
    {
      description: 'key is not an array { key: "not-an-array" }',
      input: { key: 'not-an-array' },
      shouldPass: false,
    },
    {
      description: 'key contains undefined { key: [undefined] }',
      input: { key: [undefined] },
      shouldPass: false,
    },
    {
      description: 'key contains a function { key: [() => {}] }',
      input: { key: [() => {}] },
      shouldPass: false,
    },
    {
      description: 'key contains a symbol { key: [Symbol("test")] }',
      input: { key: [Symbol('test')] },
      shouldPass: false,
    },
    {
      description: 'signal is null',
      input: null,
      shouldPass: false,
    },
    {
      description: 'signal is undefined',
      input: undefined,
      shouldPass: false,
    },
    {
      description: 'signal is a primitive string',
      input: 'invalid-signal',
      shouldPass: false,
    },
    {
      description: 'empty batch array []',
      input: [],
      shouldPass: false,
    },
  ]

  for (const fixture of fixtures) {
    it(`client and server agree on: ${fixture.description}`, () => {
      let clientPassed: boolean
      let serverPassed: boolean

      try {
        validatePayload(fixture.input)
        clientPassed = true
      } catch {
        clientPassed = false
      }

      try {
        validateSignalPayload(fixture.input)
        serverPassed = true
      } catch {
        serverPassed = false
      }

      // Parity check: client and server must always agree
      expect(
        clientPassed,
        `Client validation returned ${String(clientPassed)} but expected ${String(fixture.shouldPass)} for: ${fixture.description}`
      ).toBe(fixture.shouldPass)

      expect(
        serverPassed,
        `Server validation returned ${String(serverPassed)} but expected ${String(fixture.shouldPass)} for: ${fixture.description}`
      ).toBe(fixture.shouldPass)

      expect(clientPassed).toBe(serverPassed)
    })
  }
})
