import { describe, expectTypeOf, test } from 'vitest'
import { tanstackQueryAdapter } from '@/client/tanstack-query/index.js'
import type { AdaptedInvalidateCallback } from '@/client/core/index.js'
import type { QueryClient } from '@tanstack/react-query'
import type { TanStackQuerySignal } from '@/types/index.js'

describe('tanstackQueryAdapter type safety', () => {
  test('tanstackQueryAdapter returns AdaptedInvalidateCallback<"tanstack-query">', () => {
    const mockQueryClient = {} as QueryClient
    const adapter = tanstackQueryAdapter(mockQueryClient)

    // Note: Intersection function type uses toMatchTypeOf per vitest expectTypeOf rules
    expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal>>()
    expectTypeOf(adapter.__restaleTarget).toEqualTypeOf<'tanstack-query'>()
  })

  test('tanstackQueryAdapter callback parameter should reject SWRSignal', () => {
    const mockQueryClient = {} as QueryClient
    const adapter = tanstackQueryAdapter(mockQueryClient)

    // @ts-expect-error tanstackQueryAdapter callback should only accept TanStackQuerySignal, rejecting SWRSignal
    adapter({ target: 'swr', key: ['users'] })
  })
})


