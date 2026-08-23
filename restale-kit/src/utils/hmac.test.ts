import { describe, expect, it } from 'vitest'
import { extractRawId, signToken, verifyToken } from './hmac.js'

describe('HMAC Token Signing & Verification', () => {
  const secret = 'super-secret-key-12345'
  const rawUUID = 'd290f1ee-6c54-4b01-90e6-d701748f0851'

  it('signs a token with raw UUID and no scoped meta', () => {
    const token = signToken(secret, rawUUID)
    expect(token).toMatch(/^[0-9a-f-]+.[0-9a-f]{64}$/)
    expect(extractRawId(token)).toBe(rawUUID)
  })

  it('signs a token with scoped meta and produces deterministic signature', () => {
    const token1 = signToken(secret, rawUUID, { userId: '42', teamId: 'eng' })
    const token2 = signToken(secret, rawUUID, { teamId: 'eng', userId: '42' })
    expect(token1).toBe(token2)
    expect(extractRawId(token1)).toBe(rawUUID)
  })

  it('verifies a valid token without scoped meta', () => {
    const token = signToken(secret, rawUUID)
    const result = verifyToken(secret, token)
    expect(result).toEqual({ valid: true, rawId: rawUUID })
  })

  it('verifies a valid token with matching scoped meta', () => {
    const token = signToken(secret, rawUUID, { userId: '42', teamId: 'eng' })
    const result = verifyToken(secret, token, { userId: '42', teamId: 'eng' })
    expect(result).toEqual({ valid: true, rawId: rawUUID })
  })

  it('verifies successfully regardless of key ordering in scoped meta', () => {
    const token = signToken(secret, rawUUID, { a: 1, b: 2, c: [1, 2] })
    const result = verifyToken(secret, token, { c: [1, 2], b: 2, a: 1 })
    expect(result).toEqual({ valid: true, rawId: rawUUID })
  })

  it('rejects a token when secret is wrong', () => {
    const token = signToken(secret, rawUUID, { userId: '42' })
    const result = verifyToken('wrong-secret', token, { userId: '42' })
    expect(result).toEqual({ valid: false, rawId: rawUUID })
  })

  it('rejects a token when raw UUID in token was tampered with', () => {
    const token = signToken(secret, rawUUID, { userId: '42' })
    const parts = token.split('.')
    const tampered = `tampered-uuid.${parts[1]}`
    const result = verifyToken(secret, tampered, { userId: '42' })
    expect(result.valid).toBe(false)
    expect(result.rawId).toBe('tampered-uuid')
  })

  it('rejects a token when signature was tampered with', () => {
    const token = signToken(secret, rawUUID, { userId: '42' })
    const parts = token.split('.')
    const tamperedSig = parts[1].replace(/^[0-9a-f]/, (c) => (c === 'a' ? 'b' : 'a'))
    const tampered = `${parts[0]}.${tamperedSig}`
    const result = verifyToken(secret, tampered, { userId: '42' })
    expect(result).toEqual({ valid: false, rawId: rawUUID })
  })

  it('rejects a token when scoped meta does not match', () => {
    const token = signToken(secret, rawUUID, { userId: '42' })
    const result = verifyToken(secret, token, { userId: '43' })
    expect(result).toEqual({ valid: false, rawId: rawUUID })
  })

  it('rejects tokens missing dot separator or malformed', () => {
    expect(verifyToken(secret, 'malformed-token-without-dot')).toEqual({ valid: false, rawId: 'malformed-token-without-dot' })
    expect(verifyToken(secret, '')).toEqual({ valid: false, rawId: '' })
    expect(verifyToken(secret, '.')).toEqual({ valid: false, rawId: '' })
  })

  it('throws when secret is empty or invalid in signToken', () => {
    expect(() => signToken('', rawUUID)).toThrowError(/secret/)
    expect(() => signToken('   ', rawUUID)).toThrowError(/secret/)
  })

  it('throws when rawUUID is empty in signToken', () => {
    expect(() => signToken(secret, '')).toThrowError(/rawUUID/)
  })

  it('extracts raw ID accurately', () => {
    expect(extractRawId('abc-123.def-456')).toBe('abc-123')
    expect(extractRawId('abc-123')).toBe('abc-123')
  })
})
