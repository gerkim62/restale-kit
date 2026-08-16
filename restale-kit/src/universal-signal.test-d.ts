import { describe, expectTypeOf, test } from 'vitest'
import type { InlineDataSignal, RevalidateSignal, UniversalSignal } from './types/protocol.js'
import { isInlineDataSignal } from './types/protocol.js'
import { makeAdaptedCallback, type AdaptedCallback } from './client/core/client-contracts.js'

describe('universal signal types', () => {
  test('enforces signal arms and callback input', () => {
    const revalidate = { key: ['todos'], exact: true } satisfies RevalidateSignal
    const inline = { key: ['todos'], inlineData: { id: 1 }, markStale: true } satisfies InlineDataSignal
    // @ts-expect-error Inline data writes cannot use exact matching.
    const invalidExact: InlineDataSignal = { key: ['todos'], inlineData: { id: 1 }, exact: false }
    // @ts-expect-error Revalidation signals cannot mark stale.
    const invalidStale: RevalidateSignal = { key: ['todos'], markStale: true }
    const batch: UniversalSignal[] = [revalidate, inline]
    const callback = makeAdaptedCallback((signal) => { void signal })
    expectTypeOf(callback).toEqualTypeOf<AdaptedCallback>()
    expectTypeOf(batch).toEqualTypeOf<UniversalSignal[]>()
    const signal: UniversalSignal = inline
    if (isInlineDataSignal(signal)) expectTypeOf(signal).toEqualTypeOf<InlineDataSignal>()
    void invalidExact
    void invalidStale
  })
})
