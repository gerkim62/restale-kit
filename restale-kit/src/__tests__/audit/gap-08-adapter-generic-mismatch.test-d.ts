/**
 * Gap 8: Adapter generic parameters are not tied to their adapter target
 * 
 * tanstackQueryAdapter and swrAdapter accept any TSignal extends InvalidateSignal.
 * This allows creating adapters with incompatible signal types like
 * tanstackQueryAdapter<SWRSignal>(...) or swrAdapter<TanStackQuerySignal>(...).
 * Both callbacks are branded for one target but silently ignore their declared input.
 */

import { describe, expectTypeOf, test } from 'vitest'
import { tanstackQueryAdapter, useTanstackQueryAdapter } from '@/client/tanstack-query/index.js'
import { swrAdapter, useSwrAdapter, type SWRMutator } from '@/client/swr/index.js'
import type { AdaptedInvalidateCallback } from '@/client/core/index.js'
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal, InvalidateSignal, GenericInvalidateSignal } from '@/types/index.js'

describe('Gap 8: Adapter generic parameters must match adapter target', () => {
  describe('tanstackQueryAdapter type parameter validation', () => {
    test('should reject SWRSignal type parameter', () => {
      const mockQueryClient = {} as any
      
      // @ts-expect-error - SWRSignal incompatible with TanStack adapter
      const adapter = tanstackQueryAdapter<SWRSignal>(mockQueryClient)
    })

    test('should reject RTKQuerySignal type parameter', () => {
      const mockQueryClient = {} as any
      
      // @ts-expect-error - RTKQuerySignal incompatible with TanStack adapter
      const adapter = tanstackQueryAdapter<RTKQuerySignal>(mockQueryClient)
    })

    test('should accept TanStackQuerySignal type parameter', () => {
      const mockQueryClient = {} as any
      
      const adapter = tanstackQueryAdapter<TanStackQuerySignal>(mockQueryClient)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal>>()
    })

    test('should accept GenericInvalidateSignal type parameter', () => {
      const mockQueryClient = {} as any
      
      const adapter = tanstackQueryAdapter<GenericInvalidateSignal>(mockQueryClient)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', GenericInvalidateSignal>>()
    })

    test('should accept union of TanStack and Generic', () => {
      const mockQueryClient = {} as any
      
      const adapter = tanstackQueryAdapter<TanStackQuerySignal | GenericInvalidateSignal>(mockQueryClient)
      expectTypeOf(adapter).toBeDefined()
    })

    test('should reject union with incompatible signal types', () => {
      const mockQueryClient = {} as any
      
      // @ts-expect-error - SWRSignal incompatible with TanStack adapter
      const adapter = tanstackQueryAdapter<TanStackQuerySignal | SWRSignal>(mockQueryClient)
    })

    test('should default to correct type when no generic provided', () => {
      const mockQueryClient = {} as any
      
      const adapter = tanstackQueryAdapter(mockQueryClient)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal | GenericInvalidateSignal>>()
    })
  })

  describe('useTanstackQueryAdapter type parameter validation', () => {
    test('should reject SWRSignal type parameter', () => {
      const mockQueryClient = {} as any
      
      // @ts-expect-error - SWRSignal incompatible with TanStack adapter
      const adapter = useTanstackQueryAdapter<SWRSignal>(mockQueryClient)
    })

    test('should reject RTKQuerySignal type parameter', () => {
      const mockQueryClient = {} as any
      
      // @ts-expect-error - RTKQuerySignal incompatible with TanStack adapter
      const adapter = useTanstackQueryAdapter<RTKQuerySignal>(mockQueryClient)
    })

    test('should accept TanStackQuerySignal type parameter', () => {
      const mockQueryClient = {} as any
      
      const adapter = useTanstackQueryAdapter<TanStackQuerySignal>(mockQueryClient)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal>>()
    })

    test('should accept GenericInvalidateSignal type parameter', () => {
      const mockQueryClient = {} as any
      
      const adapter = useTanstackQueryAdapter<GenericInvalidateSignal>(mockQueryClient)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', GenericInvalidateSignal>>()
    })

    test('should reject union with incompatible types', () => {
      const mockQueryClient = {} as any
      
      // @ts-expect-error - SWRSignal incompatible with TanStack adapter
      const adapter = useTanstackQueryAdapter<TanStackQuerySignal | SWRSignal>(mockQueryClient)
    })
  })

  describe('swrAdapter type parameter validation', () => {
    test('should reject TanStackQuerySignal type parameter', () => {
      const mockMutate = {} as SWRMutator
      
      // @ts-expect-error - TanStackQuerySignal incompatible with SWR adapter
      const adapter = swrAdapter<TanStackQuerySignal>(mockMutate)
    })

    test('should reject RTKQuerySignal type parameter', () => {
      const mockMutate = {} as SWRMutator
      
      // @ts-expect-error - RTKQuerySignal incompatible with SWR adapter
      const adapter = swrAdapter<RTKQuerySignal>(mockMutate)
    })

    test('should accept SWRSignal type parameter', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = swrAdapter<SWRSignal>(mockMutate)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'swr', SWRSignal>>()
    })

    test('should accept GenericInvalidateSignal type parameter', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = swrAdapter<GenericInvalidateSignal>(mockMutate)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'swr', GenericInvalidateSignal>>()
    })

    test('should accept union of SWR and Generic', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = swrAdapter<SWRSignal | GenericInvalidateSignal>(mockMutate)
      expectTypeOf(adapter).toBeDefined()
    })

    test('should reject union with incompatible signal types', () => {
      const mockMutate = {} as SWRMutator
      
      // @ts-expect-error - TanStackQuerySignal incompatible with SWR adapter
      const adapter = swrAdapter<SWRSignal | TanStackQuerySignal>(mockMutate)
    })

    test('should default to correct type when no generic provided', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = swrAdapter(mockMutate)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'swr', SWRSignal | GenericInvalidateSignal>>()
    })
  })

  describe('useSwrAdapter type parameter validation', () => {
    test('should reject TanStackQuerySignal type parameter', () => {
      const mockMutate = {} as SWRMutator
      
      // @ts-expect-error - TanStackQuerySignal incompatible with SWR adapter
      const adapter = useSwrAdapter<TanStackQuerySignal>(mockMutate)
    })

    test('should reject RTKQuerySignal type parameter', () => {
      const mockMutate = {} as SWRMutator
      
      // @ts-expect-error - RTKQuerySignal incompatible with SWR adapter
      const adapter = useSwrAdapter<RTKQuerySignal>(mockMutate)
    })

    test('should accept SWRSignal type parameter', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = useSwrAdapter<SWRSignal>(mockMutate)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'swr', SWRSignal>>()
    })

    test('should accept GenericInvalidateSignal type parameter', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = useSwrAdapter<GenericInvalidateSignal>(mockMutate)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'swr', GenericInvalidateSignal>>()
    })

    test('should reject union with incompatible types', () => {
      const mockMutate = {} as SWRMutator
      
      // @ts-expect-error - TanStackQuerySignal incompatible with SWR adapter
      const adapter = useSwrAdapter<SWRSignal | TanStackQuerySignal>(mockMutate)
    })

    test('should accept options parameter with correct signal type', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = useSwrAdapter<SWRSignal>(mockMutate, {
        toInvalidateKey: (key, signal) => {
          expectTypeOf(signal).toEqualTypeOf<SWRSignal>()
          return [String(key)]
        }
      })
      
      expectTypeOf(adapter).toBeDefined()
    })

    test('should reject options with mismatched signal type', () => {
      const mockMutate = {} as SWRMutator
      
      // @ts-expect-error - TanStack signal in options incompatible with SWR adapter
      const adapter = useSwrAdapter<SWRSignal>(mockMutate, {
        toInvalidateKey: (key, signal: TanStackQuerySignal) => {
          return [String(key)]
        }
      })
    })
  })

  describe('Custom signal types extending target signals', () => {
    test('should accept custom type extending TanStackQuerySignal', () => {
      interface CustomTanStackSignal extends TanStackQuerySignal {
        customField?: string
      }
      
      const mockQueryClient = {} as any
      
      const adapter = tanstackQueryAdapter<CustomTanStackSignal>(mockQueryClient)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', CustomTanStackSignal>>()
    })

    test('should accept custom type extending SWRSignal', () => {
      interface CustomSWRSignal extends SWRSignal {
        customField?: string
      }
      
      const mockMutate = {} as SWRMutator
      
      const adapter = swrAdapter<CustomSWRSignal>(mockMutate)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'swr', CustomSWRSignal>>()
    })

    test('should reject custom type not extending target signal', () => {
      interface CustomSignal extends InvalidateSignal {
        target: 'custom-target'
        customKey: string[]
      }
      
      const mockQueryClient = {} as any
      
      // @ts-expect-error - Custom signal does not extend TanStackQuerySignal
      const adapter = tanstackQueryAdapter<CustomSignal>(mockQueryClient)
    })

    test('should reject custom type with wrong base', () => {
      interface CustomSWRSignal extends SWRSignal {
        customField?: string
      }
      
      const mockQueryClient = {} as any
      
      // @ts-expect-error - SWR-based custom signal incompatible with TanStack adapter
      const adapter = tanstackQueryAdapter<CustomSWRSignal>(mockQueryClient)
    })
  })

  describe('Adapter return type validation', () => {
    test('TanStack adapter should return branded callback with correct target', () => {
      const mockQueryClient = {} as any
      
      const adapter = tanstackQueryAdapter<TanStackQuerySignal>(mockQueryClient)
      
      // Brand should be 'tanstack-query'
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal>>()
      
      // Should not match other targets
      expectTypeOf(adapter).not.toMatchTypeOf<AdaptedInvalidateCallback<'swr', any>>()
      expectTypeOf(adapter).not.toMatchTypeOf<AdaptedInvalidateCallback<'rtk-query', any>>()
    })

    test('SWR adapter should return branded callback with correct target', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = swrAdapter<SWRSignal>(mockMutate)
      
      // Brand should be 'swr'
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'swr', SWRSignal>>()
      
      // Should not match other targets
      expectTypeOf(adapter).not.toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', any>>()
      expectTypeOf(adapter).not.toMatchTypeOf<AdaptedInvalidateCallback<'rtk-query', any>>()
    })

    test('should maintain signal type in callback signature', () => {
      const mockQueryClient = {} as any
      
      const adapter = tanstackQueryAdapter<TanStackQuerySignal>(mockQueryClient)
      
      // Callback should accept TanStackQuerySignal
      expectTypeOf(adapter).toBeCallableWith({ target: 'tanstack-query', queryKey: ['test'] })
      
      // @ts-expect-error - Should not accept SWRSignal
      adapter({ target: 'swr', key: ['test'] })
    })

    test('should maintain signal type in hook callback signature', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = useSwrAdapter<SWRSignal>(mockMutate)
      
      // Callback should accept SWRSignal
      expectTypeOf(adapter).toBeCallableWith({ target: 'swr', key: ['test'] })
      
      // @ts-expect-error - Should not accept TanStackQuerySignal
      adapter({ target: 'tanstack-query', queryKey: ['test'] })
    })
  })

  describe('Generic InvalidateSignal handling', () => {
    test('TanStack adapter should accept InvalidateSignal but maintain type safety', () => {
      const mockQueryClient = {} as any
      
      // When using InvalidateSignal, adapter should still be branded correctly
      const adapter = tanstackQueryAdapter<InvalidateSignal>(mockQueryClient)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', InvalidateSignal>>()
    })

    test('SWR adapter should accept InvalidateSignal but maintain type safety', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = swrAdapter<InvalidateSignal>(mockMutate)
      expectTypeOf(adapter).toMatchTypeOf<AdaptedInvalidateCallback<'swr', InvalidateSignal>>()
    })

    test('should allow narrowing from InvalidateSignal to specific type', () => {
      const mockQueryClient = {} as any
      
      // Start with broad type
      const broadAdapter = tanstackQueryAdapter<InvalidateSignal>(mockQueryClient)
      
      // Should be able to use with TanStack signals
      broadAdapter({ target: 'tanstack-query', queryKey: ['test'] })
      
      // But type system won't prevent other signals (this is the current behavior)
      broadAdapter({ target: 'swr', key: ['test'] } as any)
    })
  })

  describe('Adapter assignment and composition', () => {
    test('should not allow assigning TanStack adapter to SWR callback type', () => {
      const mockQueryClient = {} as any
      
      const tanstackAdapter = tanstackQueryAdapter<TanStackQuerySignal>(mockQueryClient)
      
      // @ts-expect-error - TanStack adapter incompatible with SWR callback type
      const swrCallback: AdaptedInvalidateCallback<'swr', SWRSignal> = tanstackAdapter
    })

    test('should not allow assigning SWR adapter to TanStack callback type', () => {
      const mockMutate = {} as SWRMutator
      
      const swrAdapter_ = swrAdapter<SWRSignal>(mockMutate)
      
      // @ts-expect-error - SWR adapter incompatible with TanStack callback type
      const tanstackCallback: AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal> = swrAdapter_
    })

    test('should allow assigning to compatible generic types', () => {
      const mockQueryClient = {} as any
      
      const adapter = tanstackQueryAdapter<TanStackQuerySignal>(mockQueryClient)
      
      // Should be assignable to InvalidateSignal version (widening)
      const broadCallback: AdaptedInvalidateCallback<'tanstack-query', InvalidateSignal> = adapter
      expectTypeOf(broadCallback).toBeDefined()
    })
  })

  describe('Edge cases with type parameters', () => {
    test('should handle never type appropriately', () => {
      const mockQueryClient = {} as any
      
      // @ts-expect-error - never is not a valid signal type
      const adapter = tanstackQueryAdapter<never>(mockQueryClient)
    })

    test('should handle unknown type appropriately', () => {
      const mockQueryClient = {} as any
      
      // @ts-expect-error - unknown is not a valid signal type
      const adapter = tanstackQueryAdapter<unknown>(mockQueryClient)
    })

    test('should handle any type (though not recommended)', () => {
      const mockQueryClient = {} as any
      
      // 'any' bypasses type checking, but should still work
      const adapter = tanstackQueryAdapter<any>(mockQueryClient)
      expectTypeOf(adapter).toBeDefined()
    })

    test('should reject non-signal object types', () => {
      const mockQueryClient = {} as any
      
      interface NotASignal {
        foo: string
        bar: number
      }
      
      // @ts-expect-error - Non-signal type incompatible
      const adapter = tanstackQueryAdapter<NotASignal>(mockQueryClient)
    })
  })

  describe('Options parameter type consistency', () => {
    test('SWR adapter options should match signal type parameter', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = swrAdapter<SWRSignal>(mockMutate, {
        toInvalidateKey: (key, signal) => {
          // Signal should be SWRSignal
          expectTypeOf(signal).toEqualTypeOf<SWRSignal>()
          
          // Should have SWR properties
          expectTypeOf(signal.key).toBeDefined()
          
          // @ts-expect-error - Should not have TanStack properties
          const qk = signal.queryKey
          
          return [String(key)]
        }
      })
      
      expectTypeOf(adapter).toBeDefined()
    })

    test('should reject options with incompatible signal type in toInvalidateKey', () => {
      const mockMutate = {} as SWRMutator
      
      const adapter = swrAdapter<SWRSignal>(mockMutate, {
        // @ts-expect-error - toInvalidateKey receives SWRSignal, not TanStack
        toInvalidateKey: (key, signal: TanStackQuerySignal) => {
          return [String(key)]
        }
      })
    })
  })
})
