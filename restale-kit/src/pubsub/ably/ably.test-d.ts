import { expectTypeOf, test } from 'vitest'
import type { InlineDataSignal, RevalidateSignal, UniversalSignal } from '@/types/index.js'

test('universal signal type contracts', () => {
  const revalidate: RevalidateSignal = { key: ['todos'], exact: true }
  const inlineData: InlineDataSignal = { key: ['todos'], inlineData: { id: 1 }, markStale: false }
  expectTypeOf(revalidate).toExtend<UniversalSignal>()
  expectTypeOf(inlineData).toExtend<UniversalSignal>()

  // @ts-expect-error target routing is intentionally absent
  const targetSignal: UniversalSignal = { target: 'swr', key: ['todos'] }
  // @ts-expect-error inline-data signals cannot specify exact matching
  const invalidInlineData: InlineDataSignal = { key: ['todos'], inlineData: 1, exact: true }

  void targetSignal
  void invalidInlineData
})
