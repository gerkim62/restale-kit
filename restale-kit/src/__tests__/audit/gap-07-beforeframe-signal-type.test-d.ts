/**
 * Gap 7: beforeFrame loses the channel's inferred signal type
 * 
 * SSEChannelOptions.beforeFrame is always BeforeFrameFn<InvalidateSignal>.
 * A clearly SWR-only channel's guard receives the entire signal union instead
 * of SWR data. This prevents type-safe signal inspection in the guard function.
 */

import { describe, expectTypeOf, test } from 'vitest'
import { createSSEChannel } from '@/testing/index.js'
import type { BeforeFrameFn, FrameGuardCtx } from '@/types/protocol.js'
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal, InvalidateSignal, JSONValue } from '@/types/index.js'

describe('Gap 7: beforeFrame should receive narrowed signal type', () => {
  describe('SWR channel beforeFrame type narrowing', () => {
    test('should receive SWRSignal in beforeFrame context', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal') {
            // Should be narrowed to SWRSignal | SWRSignal[]
            expectTypeOf(ctx.signal).toEqualTypeOf<SWRSignal | SWRSignal[]>()
            
            // Should have SWR-specific properties
            if (!Array.isArray(ctx.signal)) {
              expectTypeOf(ctx.signal.key).not.toEqualTypeOf<never>()
              expectTypeOf(ctx.signal.action).toEqualTypeOf<'revalidate' | 'mutate' | 'purge' | 'remove' | undefined>()
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should not see TanStack properties in SWR guard', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
            // @ts-expect-error - queryKey should not exist on SWRSignal
            const qk = ctx.signal.queryKey
            
            // @ts-expect-error - exact should not exist on SWRSignal
            const exact = ctx.signal.exact
            
            // @ts-expect-error - predicate should not exist on SWRSignal
            const predicate = ctx.signal.predicate
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should handle SWR-specific actions correctly', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
            // Should allow SWR actions
            if (ctx.signal.action === 'purge') {
              return { action: 'skip' }
            }
            if (ctx.signal.action === 'mutate') {
              expectTypeOf(ctx.signal.revalidate).toEqualTypeOf<boolean | undefined>()
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should handle SWR signal arrays', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && Array.isArray(ctx.signal)) {
            // Should be SWRSignal[]
            expectTypeOf(ctx.signal).toEqualTypeOf<SWRSignal[]>()
            
            for (const sig of ctx.signal) {
              expectTypeOf(sig.key).not.toEqualTypeOf<never>()
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })
  })

  describe('TanStack Query channel beforeFrame type narrowing', () => {
    test('should receive TanStackQuerySignal in beforeFrame context', () => {
      const channel = createSSEChannel<TanStackQuerySignal>({ 
        target: 'tanstack-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal') {
            // Should be narrowed to TanStackQuerySignal | TanStackQuerySignal[]
            expectTypeOf(ctx.signal).toEqualTypeOf<TanStackQuerySignal | TanStackQuerySignal[]>()
            
            // Should have TanStack-specific properties
            if (!Array.isArray(ctx.signal)) {
              expectTypeOf(ctx.signal.queryKey).not.toEqualTypeOf<never>()
              expectTypeOf(ctx.signal.action).toEqualTypeOf<'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel' | undefined>()
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should not see SWR properties in TanStack guard', () => {
      const channel = createSSEChannel<TanStackQuerySignal>({ 
        target: 'tanstack-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
            // @ts-expect-error - key should not exist on TanStackQuerySignal
            const k = ctx.signal.key
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should handle TanStack-specific properties correctly', () => {
      const channel = createSSEChannel<TanStackQuerySignal>({ 
        target: 'tanstack-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
            // Should allow TanStack-specific properties
            if (ctx.signal.exact) {
              return { action: 'send' }
            }
            // @ts-expect-error - predicate should not exist on TanStackQuerySignal
            const p = ctx.signal.predicate
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should handle TanStack signal arrays', () => {
      const channel = createSSEChannel<TanStackQuerySignal>({ 
        target: 'tanstack-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && Array.isArray(ctx.signal)) {
            // Should be TanStackQuerySignal[]
            expectTypeOf(ctx.signal).toEqualTypeOf<TanStackQuerySignal[]>()
            
            for (const sig of ctx.signal) {
              expectTypeOf(sig.queryKey).not.toEqualTypeOf<never>()
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })
  })

  describe('RTK Query channel beforeFrame type narrowing', () => {
    test('should receive RTKQuerySignal in beforeFrame context', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ 
        target: 'rtk-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal') {
            // Should be narrowed to RTKQuerySignal | RTKQuerySignal[]
            expectTypeOf(ctx.signal).toEqualTypeOf<RTKQuerySignal | RTKQuerySignal[]>()
            
            // Should have RTK-specific properties
            if (!Array.isArray(ctx.signal)) {
              expectTypeOf(ctx.signal.tags).not.toEqualTypeOf<never>()
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should not see other target properties in RTK guard', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ 
        target: 'rtk-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
            // @ts-expect-error - key should not exist on RTKQuerySignal
            const k = ctx.signal.key
            
            // @ts-expect-error - queryKey should not exist on RTKQuerySignal
            const qk = ctx.signal.queryKey
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should handle RTK tag structure correctly', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ 
        target: 'rtk-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
            // Should see tags array
            expectTypeOf(ctx.signal.tags).not.toEqualTypeOf<never>()
            
            if (ctx.signal.tags) {
              for (const tag of ctx.signal.tags) {
                if (typeof tag === 'object' && tag !== null) {
                  expectTypeOf(tag.type).toEqualTypeOf<string>()
                  expectTypeOf(tag.id).toEqualTypeOf<string | number | undefined>()
                }
              }
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should handle RTK signal arrays', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ 
        target: 'rtk-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && Array.isArray(ctx.signal)) {
            // Should be RTKQuerySignal[]
            expectTypeOf(ctx.signal).toEqualTypeOf<RTKQuerySignal[]>()
            
            for (const sig of ctx.signal) {
              expectTypeOf(sig.tags).not.toEqualTypeOf<never>()
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })
  })

  describe('Multi-target channel beforeFrame type', () => {
    test('should receive union type for multi-target channel', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const,
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal') {
            // Should be union of configured signals
            expectTypeOf(ctx.signal).toEqualTypeOf<
              SWRSignal | TanStackQuerySignal | (SWRSignal | TanStackQuerySignal)[]
            >()
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should require type guards for multi-target signal inspection', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const,
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
            // Need to check target to narrow type
            if (ctx.signal.target === 'swr') {
              expectTypeOf(ctx.signal.key).not.toEqualTypeOf<never>()
            } else if (ctx.signal.target === 'tanstack-query') {
              expectTypeOf(ctx.signal.queryKey).not.toEqualTypeOf<never>()
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should handle three-target configuration', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query', 'rtk-query'] as const,
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal') {
            // Should be union of all three
            expectTypeOf(ctx.signal).toExtend<
              SWRSignal | TanStackQuerySignal | RTKQuerySignal | (SWRSignal | TanStackQuerySignal | RTKQuerySignal)[]
            >()
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })
  })

  describe('FrameGuardCtx structure for different frame types', () => {
    test('should have correct type for signal frames', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal') {
            expectTypeOf(ctx.frameType).toEqualTypeOf<'signal'>()
            expectTypeOf(ctx.signal).not.toEqualTypeOf<never>()
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should have correct type for keepalive frames', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        guardKeepalive: true,
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'keepalive') {
            expectTypeOf(ctx.frameType).toEqualTypeOf<'keepalive'>()
            expectTypeOf(ctx.signal).toEqualTypeOf<undefined>()
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should handle all frame types in guard', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        guardKeepalive: true,
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal') {
            expectTypeOf(ctx.signal).not.toEqualTypeOf<never>()
          } else if (ctx.frameType === 'keepalive') {
            expectTypeOf(ctx.frameType).toEqualTypeOf<'keepalive'>()
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })
  })

  describe('BeforeFrameFn type parameter', () => {
    test('BeforeFrameFn should be parameterized by signal type', () => {
      type SWRBeforeFrame = BeforeFrameFn<SWRSignal>
      
      const swrGuard: SWRBeforeFrame = (ctx) => {
        if (ctx.frameType === 'signal') {
          expectTypeOf(ctx.signal).toEqualTypeOf<SWRSignal | SWRSignal[]>()
        }
        return { action: 'send' }
      }
      
      expectTypeOf(swrGuard).toExtend<SWRBeforeFrame>()
    })

    test('should reject incompatible signal assumptions in guard', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
            // @ts-expect-error - Cannot access queryKey on SWR signal
            const qk = ctx.signal.queryKey
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })
  })

  describe('Generic InvalidateSignal guard should still work', () => {
    test('should accept generic InvalidateSignal guard on any channel', () => {
      const genericGuard: BeforeFrameFn<InvalidateSignal> = (ctx) => {
        if (ctx.frameType === 'signal') {
          expectTypeOf(ctx.signal).toEqualTypeOf<InvalidateSignal | InvalidateSignal[]>()
        }
        return { action: 'send' }
      }
      
      // Should work with any channel type
      const swrChannel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        beforeFrame: genericGuard
      })
      
      const tanstackChannel = createSSEChannel<TanStackQuerySignal>({ 
        target: 'tanstack-query',
        beforeFrame: genericGuard
      })
      
      expectTypeOf(swrChannel).not.toEqualTypeOf<never>()
      expectTypeOf(tanstackChannel).not.toEqualTypeOf<never>()
    })

    test('should reject narrow guard on wide channel due to input contravariance', () => {
      const swrGuard: BeforeFrameFn<SWRSignal> = (ctx) => {
        if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
          expectTypeOf(ctx.signal.key).not.toEqualTypeOf<never>()
        }
        return { action: 'send' }
      }
      
      const channel = createSSEChannel<InvalidateSignal>({ 
        target: 'swr',
        // @ts-expect-error - SWR guard cannot accept wider InvalidateSignal
        beforeFrame: swrGuard
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })
  })

  describe('Edge cases and complex scenarios', () => {
    test('should handle conditional logic based on signal content', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
            // Should be able to inspect SWR-specific fields
            if (ctx.signal.action === 'purge') {
              return { action: 'skip' }
            }
            
            // Should be able to check key structure
            if (ctx.signal.key && ctx.signal.key.length > 2) {
              return { action: 'close' }
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should handle guards that transform signal arrays', () => {
      const channel = createSSEChannel<TanStackQuerySignal>({ 
        target: 'tanstack-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal' && Array.isArray(ctx.signal)) {
            // Should be able to iterate and inspect
            for (const sig of ctx.signal) {
              if (sig.action === 'reset') {
                return { action: 'skip' }
              }
            }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should maintain type safety in nested conditions', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ 
        target: 'rtk-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal') {
            if (!Array.isArray(ctx.signal)) {
              if (ctx.signal.tags) {
                // Should see RTK tag structure
                const hasStringId = ctx.signal.tags.some(t => typeof t === 'object' && t !== null && typeof t.id === 'string')
                if (hasStringId) {
                  return { action: 'send' }
                }
              }
            }
          }
          return { action: 'skip' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })
  })

  describe('Return type validation', () => {
    test('should accept all valid FrameGuardResult actions', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal') {
            const choice = Math.random()
            if (choice > 0.66) {
              return { action: 'send' }
            }
            if (choice > 0.33) {
              return { action: 'skip' }
            }
            return { action: 'close' }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should reject invalid action values', () => {
      const channel = createSSEChannel<SWRSignal>({ 
        target: 'swr',
        // @ts-expect-error - Invalid action value
        beforeFrame: (ctx) => {
          if (ctx.frameType === 'signal') {
            return { action: 'invalid' }
          }
          return { action: 'send' }
        }
      })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })
  })
})
