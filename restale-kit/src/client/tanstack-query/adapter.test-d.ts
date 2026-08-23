import { expectTypeOf, test } from 'vitest'
import type { InlineDataSignal, RevalidateSignal, Signal } from '@/types/index.js'
import { tanstackQueryAdapter, type TanStackQueryAdapterOptions, type QueryClientLike } from '@/client/tanstack-query/index.js'
import type { InvalidationHandler } from '@/client/core/index.js'

test('signal type contracts', () => {
  const revalidate: RevalidateSignal = { key: ['todos'], exact: true }
  const inlineData: InlineDataSignal = { key: ['todos'], inlineData: { id: 1 }, markStale: false }
  expectTypeOf(revalidate).toExtend<Signal>()
  expectTypeOf(inlineData).toExtend<Signal>()

  // @ts-expect-error target routing is intentionally absent
  const targetSignal: Signal = { target: 'swr', key: ['todos'] }
  // @ts-expect-error inline-data signals cannot specify exact matching
  const invalidInlineData: InlineDataSignal = { key: ['todos'], inlineData: 1, exact: true }

  void targetSignal
  void invalidInlineData
})

test('TanStackQueryAdapterOptions and adapter return contracts', () => {
  const options: TanStackQueryAdapterOptions = {
    toQueryKey: (key) => ['prefix', ...key],
  }
  expectTypeOf(options).toEqualTypeOf<TanStackQueryAdapterOptions>()

  const dummyClient: QueryClientLike = {
    setQueryData: () => {},
    invalidateQueries: async () => {},
  }

  const handler = tanstackQueryAdapter(dummyClient, options)
  expectTypeOf(handler).toEqualTypeOf<InvalidationHandler>()
})
