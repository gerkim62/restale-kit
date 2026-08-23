import { expectTypeOf, test } from 'vitest'
import type { InlineDataSignal, RevalidateSignal, Signal } from '@/types/index.js'
import type { InlineDataResolver, SSEChannelGroupOptions } from '@/server/core/index.js'

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

test('InlineDataResolver and SSEChannelGroupOptions type contracts', () => {
  type Meta = { userId: string }
  type Context = { page: number }

  const resolver: InlineDataResolver<Meta, Context> = (connections, payload) => {
    expectTypeOf(connections[0].meta).toEqualTypeOf<Meta | undefined>()
    expectTypeOf(connections[0].clientContext).toEqualTypeOf<Context | undefined>()
    void payload
    return new Map([
      [connections[0].connectionId, { signal: { key: ['todos'] }, inlineData: { ok: true } }],
    ])
  }

  const options: SSEChannelGroupOptions<Meta, Context> = {
    inlineDataResolver: resolver,
    onInlineDataResolverError: (info) => {
      expectTypeOf(info.topic).toEqualTypeOf<string>()
      expectTypeOf(info.missingConnectionIds).toEqualTypeOf<readonly string[]>()
    },
  }

  expectTypeOf(options).toEqualTypeOf<SSEChannelGroupOptions<Meta, Context>>()
})
