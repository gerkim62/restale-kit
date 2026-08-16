import { expectTypeOf, test } from 'vitest'
import type { InlineDataSignal, RevalidateSignal, UniversalSignal } from '@/types/index.js'

test('universal protocol types preserve the signal distinction', () => {
  const revalidate: RevalidateSignal = { key: ['todos'], exact: true }
  const inline: InlineDataSignal = { key: ['todos'], inlineData: { id: 1 }, markStale: false }
  const universal: UniversalSignal = Math.random() > 0.5 ? revalidate : inline

  expectTypeOf(universal).toEqualTypeOf<UniversalSignal>()

  // @ts-expect-error target routing was removed from the universal wire protocol
  const targetSignal: UniversalSignal = { target: 'swr', key: ['todos'] }
  // @ts-expect-error inline-data signals cannot specify exact matching
  const conflictingSignal: InlineDataSignal = { key: ['todos'], inlineData: 1, exact: true }

  void targetSignal
  void conflictingSignal
})
