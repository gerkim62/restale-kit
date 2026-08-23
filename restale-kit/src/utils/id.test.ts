import { describe, it, expect } from 'vitest'
import { generateUUID, generateInstanceId } from './id.js'

describe('id utils', () => {
  it('generates a valid UUID string using native crypto.randomUUID', () => {
    const uuid = generateUUID()
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('generateInstanceId returns a valid UUID', () => {
    const instanceId = generateInstanceId()
    expect(instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })
})
