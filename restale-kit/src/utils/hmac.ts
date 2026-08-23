import crypto from 'node:crypto'
import { canonicalJsonSerialize } from './canonical-hash.js'

/**
 * Computes an HMAC-SHA256 signature for a raw UUID and optional scoped meta.
 */
function computeSignature(secret: string, rawUUID: string, scopedMeta?: Record<string, unknown>): string {
  let scopePayload = ''
  if (scopedMeta !== undefined) {
    const serialized = canonicalJsonSerialize(scopedMeta)
    if (serialized === undefined) {
      throw new TypeError('[computeSignature] Invalid scopedMeta: cannot be canonically serialized to JSON.')
    }
    scopePayload = serialized
  }
  const payload = `${rawUUID}${scopePayload}`
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

/**
 * Signs a connection token using HMAC-SHA256.
 * Format: `<rawUUID>.<hexSignature>`
 */
export function signToken(secret: string, rawUUID: string, scopedMeta?: Record<string, unknown>): string {
  if (typeof secret !== 'string' || !secret.trim()) {
    throw new Error('[signToken] secret must be a non-empty string.')
  }
  if (typeof rawUUID !== 'string' || !rawUUID.trim()) {
    throw new Error('[signToken] rawUUID must be a non-empty string.')
  }

  const sig = computeSignature(secret, rawUUID, scopedMeta)
  return `${rawUUID}.${sig}`
}

/**
 * Extracts the raw UUID component of a connection token.
 */
export function extractRawId(token: string): string {
  if (typeof token !== 'string') return ''
  const dotIndex = token.indexOf('.')
  return dotIndex === -1 ? token : token.slice(0, dotIndex)
}

/**
 * Verifies a connection token against expected scoped meta in constant time.
 */
export function verifyToken(
  secret: string,
  token: string,
  scopedMeta?: Record<string, unknown>,
): { valid: boolean; rawId: string } {
  if (typeof secret !== 'string' || !secret.trim() || typeof token !== 'string' || !token) {
    return { valid: false, rawId: typeof token === 'string' ? token : '' }
  }

  const dotIndex = token.indexOf('.')
  if (dotIndex === -1 || dotIndex === 0 || dotIndex === token.length - 1) {
    const rawId = dotIndex === 0 ? '' : (dotIndex === -1 ? token : token.slice(0, dotIndex))
    return { valid: false, rawId }
  }

  const rawId = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)

  try {
    const expectedSig = computeSignature(secret, rawId, scopedMeta)
    const sigBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSig, 'hex')

    if (sigBuffer.length !== expectedBuffer.length || sigBuffer.length === 0) {
      return { valid: false, rawId }
    }

    const match = crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    return { valid: match, rawId }
  } catch {
    return { valid: false, rawId }
  }
}
