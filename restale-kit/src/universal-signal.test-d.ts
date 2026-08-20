import { describe, expectTypeOf, test } from 'vitest'
import type { InlineDataSignal, RevalidateSignal, Signal } from './types/protocol.js'
import { isInlineDataSignal } from './types/protocol.js'
import { makeInvalidationHandler, type InvalidationHandler } from './client/core/client-contracts.js'

describe('signal types', () => {
  test('enforces signal arms and callback input', () => {
    const revalidate = { key: ['todos'], exact: true } satisfies RevalidateSignal
    const inline = { key: ['todos'], inlineData: { id: 1 }, markStale: true } satisfies InlineDataSignal
    // @ts-expect-error Inline data writes cannot use exact matching.
    const invalidExact: InlineDataSignal = { key: ['todos'], inlineData: { id: 1 }, exact: false }
    // @ts-expect-error Revalidation signals cannot mark stale.
    const invalidStale: RevalidateSignal = { key: ['todos'], markStale: true }
    const batch: Signal[] = [revalidate, inline]
    const callback = makeInvalidationHandler((signal: Signal | Signal[]) => { void signal })
    expectTypeOf(callback).toEqualTypeOf<InvalidationHandler>()
    expectTypeOf(batch).toEqualTypeOf<Signal[]>()
    const signal: Signal = inline
    if (isInlineDataSignal(signal)) expectTypeOf(signal).toEqualTypeOf<InlineDataSignal>()
    void invalidExact
    void invalidStale
  })
})
