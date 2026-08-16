import { expectTypeOf, test } from 'vitest'
import type { UniversalSignal } from '@/types/index.js'
test('universal signals do not expose target routing', () => {
  const signal: UniversalSignal = { key: ['todos'], exact: true }
  expectTypeOf(signal).toExtend<UniversalSignal>()
  // @ts-expect-error target routing is intentionally absent
  const targetSignal: UniversalSignal = { target: 'swr', key: ['todos'] }
  void targetSignal
})
