/**
 * Gap 9: Client target and event-payload type can contradict each other
 * 
 * SSEInvalidatorClient has independent TSignal and ClientOptions.target, allowing:
 * new SSEInvalidatorClient<SWRSignal>(url, { target: 'tanstack-query' })
 * 
 * Events are typed as SWR while the negotiated connection asks for TanStack.
 * makeAdaptedCallback has the same issue: its target brand is independent of
 * the callback's signal type.
 */

import { describe, expectTypeOf, test } from 'vitest'
import { SSEInvalidatorClient, type ClientOptions } from '@/client/core/index.js'
import { makeAdaptedCallback, type AdaptedInvalidateCallback } from '@/client/core/index.js'
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal, InvalidateSignal } from '@/types/index.js'

describe('Gap 9: Client target and signal type must be consistent', () => {
  describe('SSEInvalidatorClient generic and options.target validation', () => {
    test('should reject SWRSignal generic with tanstack-query target', () => {
      const url = 'http://localhost/sse'
      
      // @ts-expect-error - SWRSignal generic conflicts with tanstack-query target
      const client = new SSEInvalidatorClient<SWRSignal>(url, { target: 'tanstack-query' })
    })

    test('should reject TanStackQuerySignal generic with swr target', () => {
      const url = 'http://localhost/sse'
      
      // @ts-expect-error - TanStackQuerySignal generic conflicts with swr target
      const client = new SSEInvalidatorClient<TanStackQuerySignal>(url, { target: 'swr' })
    })

    test('should reject RTKQuerySignal generic with swr target', () => {
      const url = 'http://localhost/sse'
      
      // @ts-expect-error - RTKQuerySignal generic conflicts with swr target
      const client = new SSEInvalidatorClient<RTKQuerySignal>(url, { target: 'swr' })
    })

    test('should reject TanStackQuerySignal generic with rtk-query target', () => {
      const url = 'http://localhost/sse'
      
      // @ts-expect-error - TanStackQuerySignal generic conflicts with rtk-query target
      const client = new SSEInvalidatorClient<TanStackQuerySignal>(url, { target: 'rtk-query' })
    })

    test('should accept matching SWRSignal generic with swr target', () => {
      const url = 'http://localhost/sse'
      
      const client = new SSEInvalidatorClient<SWRSignal>(url, { target: 'swr' })
      expectTypeOf(client).not.toEqualTypeOf<never>()
    })

    test('should accept matching TanStackQuerySignal generic with tanstack-query target', () => {
      const url = 'http://localhost/sse'
      
      const client = new SSEInvalidatorClient<TanStackQuerySignal>(url, { target: 'tanstack-query' })
      expectTypeOf(client).not.toEqualTypeOf<never>()
    })

    test('should accept matching RTKQuerySignal generic with rtk-query target', () => {
      const url = 'http://localhost/sse'
      
      const client = new SSEInvalidatorClient<RTKQuerySignal>(url, { target: 'rtk-query' })
      expectTypeOf(client).not.toEqualTypeOf<never>()
    })

    test('should allow omitting target when using InvalidateSignal', () => {
      const url = 'http://localhost/sse'
      
      // Generic client without target specification
      const client = new SSEInvalidatorClient<InvalidateSignal>(url)
      expectTypeOf(client).not.toEqualTypeOf<never>()
    })

    test('should allow omitting target when using specific signal type', () => {
      const url = 'http://localhost/sse'
      
      // Client can be created without target if signal type is specified
      // (target will be negotiated or inferred)
      const client = new SSEInvalidatorClient<SWRSignal>(url)
      expectTypeOf(client).not.toEqualTypeOf<never>()
    })
  })

  describe('ClientOptions.target type safety', () => {
    test('should only accept valid signal target literals', () => {
      const url = 'http://localhost/sse'
      
      // Valid targets
      const swrClient = new SSEInvalidatorClient<SWRSignal>(url, { target: 'swr' })
      const tanstackClient = new SSEInvalidatorClient<TanStackQuerySignal>(url, { target: 'tanstack-query' })
      const rtkClient = new SSEInvalidatorClient<RTKQuerySignal>(url, { target: 'rtk-query' })
      
      expectTypeOf(swrClient).not.toEqualTypeOf<never>()
      expectTypeOf(tanstackClient).not.toEqualTypeOf<never>()
      expectTypeOf(rtkClient).not.toEqualTypeOf<never>()
      
      // @ts-expect-error - Invalid target string
      const invalidClient = new SSEInvalidatorClient<SWRSignal>(url, { target: 'invalid-target' })
    })

    test('should reject plain string type for target', () => {
      const url = 'http://localhost/sse'
      const dynamicTarget: string = 'swr'
      
      // @ts-expect-error - Plain string too broad
      const client = new SSEInvalidatorClient<SWRSignal>(url, { target: dynamicTarget })
    })

    test('should accept const-asserted target', () => {
      const url = 'http://localhost/sse'
      const target = 'swr' as const
      
      const client = new SSEInvalidatorClient<SWRSignal>(url, { target })
      expectTypeOf(client).not.toEqualTypeOf<never>()
    })
  })

  describe('makeAdaptedCallback brand and signal type consistency', () => {
    test('should reject SWRSignal with tanstack-query brand', () => {
      const callback = (signal: SWRSignal | SWRSignal[]) => {
        // Process SWR signal
      }
      
      // @ts-expect-error - SWRSignal incompatible with tanstack-query brand
      const adapted = makeAdaptedCallback<'tanstack-query', SWRSignal>('tanstack-query', callback)
    })

    test('should reject TanStackQuerySignal with swr brand', () => {
      const callback = (signal: TanStackQuerySignal | TanStackQuerySignal[]) => {
        // Process TanStack signal
      }
      
      // @ts-expect-error - TanStackQuerySignal incompatible with swr brand
      const adapted = makeAdaptedCallback<'swr', TanStackQuerySignal>('swr', callback)
    })

    test('should reject RTKQuerySignal with swr brand', () => {
      const callback = (signal: RTKQuerySignal | RTKQuerySignal[]) => {
        // Process RTK signal
      }
      
      // @ts-expect-error - RTKQuerySignal incompatible with swr brand
      const adapted = makeAdaptedCallback<'swr', RTKQuerySignal>('swr', callback)
    })

    test('should accept matching SWRSignal with swr brand', () => {
      const callback = (signal: SWRSignal | SWRSignal[]) => {
        // Process SWR signal
      }
      
      const adapted = makeAdaptedCallback<'swr', SWRSignal>('swr', callback)
      expectTypeOf(adapted).toMatchTypeOf<AdaptedInvalidateCallback<'swr', SWRSignal>>()
    })

    test('should accept matching TanStackQuerySignal with tanstack-query brand', () => {
      const callback = (signal: TanStackQuerySignal | TanStackQuerySignal[]) => {
        // Process TanStack signal
      }
      
      const adapted = makeAdaptedCallback<'tanstack-query', TanStackQuerySignal>('tanstack-query', callback)
      expectTypeOf(adapted).toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal>>()
    })

    test('should accept matching RTKQuerySignal with rtk-query brand', () => {
      const callback = (signal: RTKQuerySignal | RTKQuerySignal[]) => {
        // Process RTK signal
      }
      
      const adapted = makeAdaptedCallback<'rtk-query', RTKQuerySignal>('rtk-query', callback)
      expectTypeOf(adapted).toMatchTypeOf<AdaptedInvalidateCallback<'rtk-query', RTKQuerySignal>>()
    })

    test('should reject InvalidateSignal with specific target brand because it includes incompatible signals', () => {
      const callback = (signal: InvalidateSignal | InvalidateSignal[]) => {
        // Generic signal processing
      }
      
      // @ts-expect-error - InvalidateSignal includes non-SWR signals
      const swrBranded = makeAdaptedCallback<'swr', InvalidateSignal>('swr', callback)
      // @ts-expect-error - InvalidateSignal includes non-TanStack signals
      const tanstackBranded = makeAdaptedCallback<'tanstack-query', InvalidateSignal>('tanstack-query', callback)
    })
  })

  describe('AdaptedInvalidateCallback type parameter validation', () => {
    test('should enforce TTarget and TSignal consistency', () => {
      // Valid: matching target and signal type
      type ValidSwrCallback = AdaptedInvalidateCallback<'swr', SWRSignal>
      type ValidTanstackCallback = AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal>
      type ValidRtkCallback = AdaptedInvalidateCallback<'rtk-query', RTKQuerySignal>
      
      expectTypeOf<ValidSwrCallback>().toMatchTypeOf<AdaptedInvalidateCallback<'swr', SWRSignal>>()
      expectTypeOf<ValidTanstackCallback>().toMatchTypeOf<AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal>>()
      expectTypeOf<ValidRtkCallback>().toMatchTypeOf<AdaptedInvalidateCallback<'rtk-query', RTKQuerySignal>>()
    })

    test('should reject type alias with mismatched target and signal', () => {
      type InvalidCallback = AdaptedInvalidateCallback<'swr', TanStackQuerySignal>
      
      const callback = (signal: TanStackQuerySignal | TanStackQuerySignal[]) => {}
      
      // @ts-expect-error - A TanStack callback cannot carry the SWR brand
      const adapted: InvalidCallback = makeAdaptedCallback('swr', callback)
    })

    test('should maintain type consistency through assignment', () => {
      const swrCallback = makeAdaptedCallback<'swr', SWRSignal>('swr', (signal) => {})
      
      // Should not be assignable to mismatched type
      // @ts-expect-error - SWR callback not assignable to TanStack type
      const wrongType: AdaptedInvalidateCallback<'tanstack-query', TanStackQuerySignal> = swrCallback
    })
  })

  describe('Union signal types with target validation', () => {
    test('should accept union signal type with compatible target', () => {
      const url = 'http://localhost/sse'
      
      // Union type should work with one of its member targets
      const client = new SSEInvalidatorClient<SWRSignal | TanStackQuerySignal>(url, { target: 'swr' })
      expectTypeOf(client).not.toEqualTypeOf<never>()
    })

    test('should reject union signal type with incompatible target', () => {
      const url = 'http://localhost/sse'
      
      const client = new SSEInvalidatorClient<SWRSignal | TanStackQuerySignal>(url, {
        // @ts-expect-error - rtk-query not in union
        target: 'rtk-query'
      })
    })

    test('should allow union signal type without target', () => {
      const url = 'http://localhost/sse'
      
      const client = new SSEInvalidatorClient<SWRSignal | TanStackQuerySignal>(url)
      expectTypeOf(client).not.toEqualTypeOf<never>()
    })
  })

  describe('Custom signal types extending base signals', () => {
    test('should maintain target consistency with custom signal types', () => {
      interface CustomSWRSignal extends SWRSignal {
        customField?: string
      }
      
      const url = 'http://localhost/sse'
      
      // Should work with matching target
      const client = new SSEInvalidatorClient<CustomSWRSignal>(url, { target: 'swr' })
      expectTypeOf(client).not.toEqualTypeOf<never>()
      
      const wrongClient = new SSEInvalidatorClient<CustomSWRSignal>(url, {
        // @ts-expect-error - Should reject mismatched target
        target: 'tanstack-query'
      })
    })

    test('should maintain brand consistency with custom signal types', () => {
      interface CustomTanStackSignal extends TanStackQuerySignal {
        customField?: string
      }
      
      const callback = (signal: CustomTanStackSignal | CustomTanStackSignal[]) => {}
      
      // Should work with matching brand
      const adapted = makeAdaptedCallback<'tanstack-query', CustomTanStackSignal>('tanstack-query', callback)
      expectTypeOf(adapted).not.toEqualTypeOf<never>()
      
      // @ts-expect-error - A custom TanStack signal cannot carry the SWR brand
      const wrongAdapted = makeAdaptedCallback<'swr', CustomTanStackSignal>(
        'swr',
        callback
      )
    })
  })

  describe('Event listener type safety', () => {
    test('should emit events with consistent signal types', () => {
      const url = 'http://localhost/sse'
      const client = new SSEInvalidatorClient<SWRSignal>(url, { target: 'swr' })
      
      client.addEventListener('invalidate', (event) => {
        // Event detail should be typed as SWRSignal or SWRSignal[]
        if (Array.isArray(event.detail)) {
          expectTypeOf(event.detail).toEqualTypeOf<SWRSignal[]>()
        } else {
          expectTypeOf(event.detail).toEqualTypeOf<SWRSignal>()
        }
      })
    })

    test('should not mix signal types across client instances', () => {
      const url = 'http://localhost/sse'
      const swrClient = new SSEInvalidatorClient<SWRSignal>(url, { target: 'swr' })
      const tanstackClient = new SSEInvalidatorClient<TanStackQuerySignal>(url, { target: 'tanstack-query' })
      
      swrClient.addEventListener('invalidate', (event) => {
        if (!Array.isArray(event.detail)) {
          expectTypeOf(event.detail.key).not.toEqualTypeOf<never>()
          // @ts-expect-error - Should not have TanStack properties
          const qk = event.detail.queryKey
        }
      })
      
      tanstackClient.addEventListener('invalidate', (event) => {
        if (!Array.isArray(event.detail)) {
          expectTypeOf(event.detail.queryKey).not.toEqualTypeOf<never>()
          // @ts-expect-error - Should not have SWR properties
          const k = event.detail.key
        }
      })
    })
  })

  describe('Integration with adapters', () => {
    test('should maintain type consistency between client and adapter', () => {
      const url = 'http://localhost/sse'
      
      const swrCallback = makeAdaptedCallback<'swr', SWRSignal>('swr', (signal) => {})
      
      // Client should match callback type
      const matchingClient = new SSEInvalidatorClient<SWRSignal>(url, { target: 'swr' })
      expectTypeOf(matchingClient).not.toEqualTypeOf<never>()
      
      const mismatchedClient = new SSEInvalidatorClient<TanStackQuerySignal>(url, {
        // @ts-expect-error - Mismatched client should not work with SWR callback
        target: 'swr'
      })
    })

    test('should prevent using incompatible adapter with client', () => {
      const url = 'http://localhost/sse'
      
      const tanstackClient = new SSEInvalidatorClient<TanStackQuerySignal>(url, { target: 'tanstack-query' })
      const swrCallback = makeAdaptedCallback<'swr', SWRSignal>('swr', (signal) => {})
      
      // In actual usage, the mismatch would be caught at the hook level
      // This documents the expected type relationship
      expectTypeOf(tanstackClient).not.toEqualTypeOf<SSEInvalidatorClient<SWRSignal>>()
    })
  })

  describe('Edge cases and type narrowing', () => {
    test('should handle never type appropriately', () => {
      const url = 'http://localhost/sse'
      
      const client = new SSEInvalidatorClient<never>(url, {
        // @ts-expect-error - never has no target
        target: 'swr'
      })
    })

    test('should handle unknown type appropriately', () => {
      const url = 'http://localhost/sse'
      
      // @ts-expect-error - unknown is not a valid signal type
      const client = new SSEInvalidatorClient<unknown>(url, { target: 'swr' })
    })

    test('should allow any type (though not recommended)', () => {
      const url = 'http://localhost/sse'
      
      // 'any' bypasses type checking
      const client = new SSEInvalidatorClient<any>(url, { target: 'swr' })
      expectTypeOf(client).not.toEqualTypeOf<never>()
    })

    test('should enforce literal types for target option', () => {
      const url = 'http://localhost/sse'
      
      type SwrTarget = 'swr'
      const target: SwrTarget = 'swr'
      
      const client = new SSEInvalidatorClient<SWRSignal>(url, { target })
      expectTypeOf(client).not.toEqualTypeOf<never>()
    })
  })

  describe('Multiple client instances', () => {
    test('should allow multiple clients with different signal types', () => {
      const url = 'http://localhost/sse'
      
      const swrClient = new SSEInvalidatorClient<SWRSignal>(url, { target: 'swr' })
      const tanstackClient = new SSEInvalidatorClient<TanStackQuerySignal>(url, { target: 'tanstack-query' })
      const rtkClient = new SSEInvalidatorClient<RTKQuerySignal>(url, { target: 'rtk-query' })
      
      expectTypeOf(swrClient).not.toEqualTypeOf<never>()
      expectTypeOf(tanstackClient).not.toEqualTypeOf<never>()
      expectTypeOf(rtkClient).not.toEqualTypeOf<never>()
      
      // Each should have distinct types
      expectTypeOf(swrClient).not.toEqualTypeOf<typeof tanstackClient>()
      expectTypeOf(tanstackClient).not.toEqualTypeOf<typeof rtkClient>()
    })

    test('should not allow assigning clients with different signal types', () => {
      const url = 'http://localhost/sse'
      
      const swrClient = new SSEInvalidatorClient<SWRSignal>(url, { target: 'swr' })
      
      // @ts-expect-error - Cannot assign SWR client to TanStack type
      const tanstackClient: SSEInvalidatorClient<TanStackQuerySignal> = swrClient
    })
  })

  describe('Type inference from target option', () => {
    test('should ideally infer signal type from target option', () => {
      const url = 'http://localhost/sse'
      
      // Ideally, signal type should be inferred from target
      // Currently requires explicit generic, but documenting desired behavior
      
      const swrClient = new SSEInvalidatorClient<SWRSignal>(url, { target: 'swr' })
      expectTypeOf(swrClient).toMatchTypeOf<SSEInvalidatorClient<SWRSignal>>()
      
      const tanstackClient = new SSEInvalidatorClient<TanStackQuerySignal>(url, { target: 'tanstack-query' })
      expectTypeOf(tanstackClient).toMatchTypeOf<SSEInvalidatorClient<TanStackQuerySignal>>()
    })
  })
})
