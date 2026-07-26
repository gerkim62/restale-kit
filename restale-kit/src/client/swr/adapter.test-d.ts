import { describe, expectTypeOf, test } from 'vitest'
import { swrAdapter, useSwrAdapter, type SWRMutator, type SWRAdapterOptions } from '@/client/swr/index.js'
import type { AdaptedInvalidateCallback } from '@/client/core/index.js'
import type { SWRSignal } from '@/types/index.js'

describe('swrAdapter type safety', () => {
  test('swrAdapter returns AdaptedInvalidateCallback<"swr">', () => {
    const mockMutate: SWRMutator = Object.assign(
      async () => [],
      () => Promise.resolve([])
    )

    const adapter = swrAdapter(mockMutate)
    // Note: Intersection function type uses toMatchTypeOf per vitest expectTypeOf rules
    expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'swr', SWRSignal>>()
    expectTypeOf(adapter.__restaleTarget).toEqualTypeOf<'swr'>()
  })

  test('useSwrAdapter hook returns branded AdaptedInvalidateCallback<"swr">', () => {
    const mockMutate: SWRMutator = Object.assign(
      async () => [],
      () => Promise.resolve([])
    )

    const adapterHook = useSwrAdapter(mockMutate)
    expectTypeOf(adapterHook).toMatchTypeOf<AdaptedInvalidateCallback<'swr', SWRSignal>>()
    expectTypeOf(adapterHook.__restaleTarget).toEqualTypeOf<'swr'>()
  })

  test('swrAdapter options toInvalidateKey callback', () => {
    const mockMutate: SWRMutator = Object.assign(
      async () => [],
      () => Promise.resolve([])
    )

    const options: SWRAdapterOptions<SWRSignal> = {
      toInvalidateKey: (key, signal) => {
        expectTypeOf(signal).toEqualTypeOf<SWRSignal>()
        return typeof key === 'string' ? [key] : undefined
      },
    }

    const adapter = swrAdapter(mockMutate, options)
    expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'swr', SWRSignal>>()
  })

  test('swrAdapter callback parameter should reject TanStackQuerySignal', () => {
    const mockMutate: SWRMutator = Object.assign(
      async () => [],
      () => Promise.resolve([])
    )
    const adapter = swrAdapter(mockMutate)

    // @ts-expect-error swrAdapter callback should only accept SWRSignal, rejecting TanStackQuerySignal
    adapter({ target: 'tanstack-query', queryKey: ['users'] })
  })

  test('swrAdapter toInvalidateKey rejects non-JSONValue array return type', () => {
    // @ts-expect-error toInvalidateKey cannot return array of functions/symbols
    const _options: SWRAdapterOptions<SWRSignal> = {
      toInvalidateKey: () => [() => {}],
    }
  })
})
