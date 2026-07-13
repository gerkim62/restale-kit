import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateUUID, generateInstanceId } from './id.js'

describe('id utils', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates a valid UUID string using native crypto.randomUUID', () => {
    const uuid = generateUUID()
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('falls back to crypto.getRandomValues when crypto.randomUUID is absent', () => {
    const originalRandomUUID = crypto.randomUUID
    // Temporary override randomUUID to undefined
    Object.defineProperty(crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    })

    try {
      const fallbackUuid = generateUUID()
      expect(fallbackUuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    } finally {
      Object.defineProperty(crypto, 'randomUUID', {
        value: originalRandomUUID,
        configurable: true,
      })
    }
  })

  it('generateInstanceId returns a valid UUID', () => {
    const instanceId = generateInstanceId()
    expect(instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })
})
