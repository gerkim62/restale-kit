import { describe, expectTypeOf, test } from 'vitest'
import { tanstackQueryAdapter, useTanstackQueryAdapter, type QueryClientLike } from '@/client/tanstack-query/index.js'
import type { AdaptedInvalidateCallback } from '@/client/core/index.js'
import type { QueryClient } from '@tanstack/react-query'
import type { TanStackQuerySignal, InvalidateSignal } from '@/types/index.js'

describe('tanstackQueryAdapter type safety', () => {
  test('tanstackQueryAdapter returns AdaptedInvalidateCallback<"tanstack-query">', () => {
    const mockQueryClient = {} as QueryClient
    const adapter = tanstackQueryAdapter(mockQueryClient)

    expectTypeOf(adapter).toExtend<AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal>>()
    expectTypeOf(adapter.__restaleTarget).toEqualTypeOf<'tanstack-query'>()
  })

  test('useTanstackQueryAdapter hook returns branded AdaptedInvalidateCallback<"tanstack-query">', () => {
    const mockQueryClient = {} as QueryClient
    const adapterHook = useTanstackQueryAdapter(mockQueryClient)

    expectTypeOf(adapterHook).toExtend<AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal>>()
    expectTypeOf(adapterHook.__restaleTarget).toEqualTypeOf<'tanstack-query'>()
  })

  test('tanstackQueryAdapter supports custom TSignal generic type parameter', () => {
    const mockQueryClient = {} as QueryClient
    interface CustomTSQuerySignal extends TanStackQuerySignal {
      customMeta?: string
    }

    const adapter = tanstackQueryAdapter<CustomTSQuerySignal>(mockQueryClient)
    expectTypeOf(adapter).toExtend<AdaptedInvalidateCallback<'tanstack-query', CustomTSQuerySignal>>()
  })

  test('tanstackQueryAdapter accepts structural QueryClientLike interface without nominal class errors', () => {
    const structuralClient = {
      invalidateQueries: async () => {},
      removeQueries: () => {},
      resetQueries: async () => {},
      cancelQueries: async () => {},
      refetchQueries: async () => {},
    }
    const adapter = tanstackQueryAdapter(structuralClient)
    expectTypeOf(adapter).toExtend<AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal>>()
    expectTypeOf(structuralClient).toExtend<QueryClientLike>()
  })

  test('rejects incompatible filter parameters on QueryClientLike', () => {
    const incompatibleClient = {
      invalidateQueries: async (_filters?: string) => {},
      removeQueries: () => {},
      resetQueries: async () => {},
      cancelQueries: async () => {},
      refetchQueries: async () => {},
    }
    expectTypeOf<typeof incompatibleClient>().not.toExtend<QueryClientLike>()
  })
})


