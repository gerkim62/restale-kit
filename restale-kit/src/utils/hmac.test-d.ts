import { expectTypeOf, test } from 'vitest'
import { extractRawId, signToken, verifyToken } from '@/utils/hmac'

test('HMAC signing and verification function signatures', () => {
  const secret = 'super-secret'
  const rawId = 'c0a80101-0000-0000-0000-000000000001'
  const scope = { userId: '123', orgId: 'org-456' }

  // 1. signToken returns string
  const signed = signToken(secret, rawId, scope)
  expectTypeOf(signed).toEqualTypeOf<string>()

  // 2. verifyToken returns { valid: boolean; rawId: string }
  const verified = verifyToken(secret, signed, scope)
  expectTypeOf(verified).toEqualTypeOf<{ valid: boolean; rawId: string }>()

  // 3. extractRawId returns string
  const extracted = extractRawId(signed)
  expectTypeOf(extracted).toEqualTypeOf<string>()
})
