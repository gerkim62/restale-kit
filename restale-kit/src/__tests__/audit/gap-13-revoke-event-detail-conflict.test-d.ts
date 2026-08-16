import { describe, expectTypeOf, test } from 'vitest'
import type { InlineDataSignal, RevalidateSignal, UniversalSignal } from '@/types/protocol.js'

describe('universal protocol regression types', () => {
  test('keeps the two signal arms distinct', () => {
    const revalidate = { key: ['todos'], exact: true } satisfies RevalidateSignal
    const inline = { key: ['todos'], inlineData: { id: 1 }, markStale: true } satisfies InlineDataSignal
    const batch: UniversalSignal[] = [revalidate, inline]
    // @ts-expect-error target is no longer a protocol field.
    const targetSignal: UniversalSignal = { key: ['todos'], target: 'swr' }
    expectTypeOf(batch).toEqualTypeOf<UniversalSignal[]>()
    void targetSignal
  })
})
