import { expectTypeOf, test } from 'vitest'
import type { InlineDataSignal, RevalidateSignal, Signal } from '@/types/index.js'

test('signal protocol types preserve the signal distinction', () => {
  const revalidate: RevalidateSignal = { key: ['todos'], exact: true }
  const inline: InlineDataSignal = { key: ['todos'], inlineData: { id: 1 }, markStale: false }
  const signal: Signal = Math.random() > 0.5 ? revalidate : inline

  expectTypeOf(signal).toEqualTypeOf<Signal>()

  // @ts-expect-error target routing was removed from the wire protocol
  const targetSignal: Signal = { target: 'swr', key: ['todos'] }
  // @ts-expect-error inline-data signals cannot specify exact matching
  const conflictingSignal: InlineDataSignal = { key: ['todos'], inlineData: 1, exact: true }

  void targetSignal
  void conflictingSignal
})
