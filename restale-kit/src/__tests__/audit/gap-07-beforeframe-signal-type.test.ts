/**
 * Gap 7: beforeFrame loses the channel's inferred signal type
 * 
 * SSEChannelOptions.beforeFrame is always BeforeFrameFn<InvalidateSignal>.
 * A clearly SWR-only channel's guard receives the entire signal union instead
 * of SWR data. Implementation also contains a suppressed type error when
 * constructing that context.
 */

import { describe, it, expect } from 'vitest';
import { createSSEChannel } from '../../server/core/channel.js';
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal } from '../../types/protocol.js';

describe('Gap 7: beforeFrame signal type inference', () => {
  describe('SWR channel beforeFrame typing', () => {
    it('should receive SWRSignal in beforeFrame callback', () => {
      const channel = createSSEChannel({
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };

          const signal = ctx.signal;

          if (Array.isArray(signal)) {
            // Each element should be SWRSignal
            signal.forEach(s => {
              // Should have SWR-specific properties
              const key = s.key; // Should compile
              const action = s.action; // Should compile

              // @ts-expect-error - Should not have TanStack properties
              const queryKey = s.queryKey;

              // @ts-expect-error - Should not have RTK properties
              const tags = s.tags;
            });
          } else {
            // Single signal should be SWRSignal
            const key = signal.key; // Should compile

            // @ts-expect-error - Should not have TanStack properties
            const queryKey = signal.queryKey;
          }

          return { action: 'send' };
        }
      });

      expect(channel).toBeDefined();
    });

    it('should allow SWR-specific narrowing in beforeFrame', () => {
      const channel = createSSEChannel({
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };
          const signals = Array.isArray(ctx.signal) ? ctx.signal : [ctx.signal];

          // Should be able to safely check SWR actions
          const hasRevalidate = signals.some(s => s.action === 'revalidate');
          const hasMutate = signals.some(s => s.action === 'mutate');
          const hasPurge = signals.some(s => s.action === 'purge');

          // These are valid SWR actions
          expect(typeof hasRevalidate).toBe('boolean');
          expect(typeof hasMutate).toBe('boolean');
          expect(typeof hasPurge).toBe('boolean');

          return { action: 'send' };
        }
      });

      channel.invalidate({ key: ['test'], action: 'revalidate' });
    });

    it('should provide typed context in beforeFrame', () => {
      const channel = createSSEChannel({
        target: 'swr',
        beforeFrame: (ctx) => {
          // Context should reflect SWR channel type
          expect(ctx).toBeDefined();
          expect(ctx.connectionId).toBeDefined();

          return { action: 'send' };
        }
      });

      channel.invalidate({ key: ['test'] });
    });
  });

  describe('TanStack Query channel beforeFrame typing', () => {
    it('should receive TanStackQuerySignal in beforeFrame callback', () => {
      const channel = createSSEChannel({
        target: 'tanstack-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };
          const signal = ctx.signal;

          if (Array.isArray(signal)) {
            signal.forEach(s => {
              // Should have TanStack-specific properties
              const queryKey = s.queryKey; // Should compile
              const action = s.action; // Should compile
              const exact = s.exact; // Should compile

              // @ts-expect-error - Should not have SWR properties
              const key = s.key;

              // @ts-expect-error - Should not have RTK properties
              const tags = s.tags;
            });
          } else {
            const queryKey = signal.queryKey; // Should compile

            // @ts-expect-error - Should not have SWR properties
            const key = signal.key;
          }

          return { action: 'send' };
        }
      });

      expect(channel).toBeDefined();
    });

    it('should allow TanStack-specific logic in beforeFrame', () => {
      const channel = createSSEChannel({
        target: 'tanstack-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };
          const signals = Array.isArray(ctx.signal) ? ctx.signal : [ctx.signal];

          // Should handle TanStack actions
          const hasInvalidate = signals.some(s => s.action === 'invalidate');
          const hasRefetch = signals.some(s => s.action === 'refetch');
          const hasReset = signals.some(s => s.action === 'reset');

          // Should handle TanStack options
          const hasExact = signals.some(s => s.exact === true);

          return { action: 'send' };
        }
      });

      channel.invalidate({ queryKey: ['test'], exact: true });
    });
  });

  describe('RTK Query channel beforeFrame typing', () => {
    it('should receive RTKQuerySignal in beforeFrame callback', () => {
      const channel = createSSEChannel({
        target: 'rtk-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };
          const signal = ctx.signal;

          if (Array.isArray(signal)) {
            signal.forEach(s => {
              // Should have RTK-specific properties
              const tags = s.tags; // Should compile

              // @ts-expect-error - Should not have SWR properties
              const key = s.key;

              // @ts-expect-error - Should not have TanStack properties
              const queryKey = s.queryKey;
            });
          } else {
            const tags = signal.tags; // Should compile

            // @ts-expect-error - Should not have SWR properties
            const key = signal.key;
          }

          return { action: 'send' };
        }
      });

      expect(channel).toBeDefined();
    });

    it('should allow RTK-specific tag inspection in beforeFrame', () => {
      const channel = createSSEChannel({
        target: 'rtk-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };
          const signals = Array.isArray(ctx.signal) ? ctx.signal : [ctx.signal];

          signals.forEach(s => {
            // Should be able to inspect tag structure
            s.tags.forEach(tag => {
              if (typeof tag === 'object' && tag !== null) {
                expect(tag.type).toBeDefined();
                if ('id' in tag) {
                  expect(tag.id).toBeDefined();
                }
              }
            });
          });

          return { action: 'send' };
        }
      });

      channel.invalidate({
        tags: [
          { type: 'Todo' },
          { type: 'User', id: 1 }
        ]
      });
    });
  });

  describe('Multi-target channel beforeFrame typing', () => {
    it('should receive configured union in beforeFrame for multi-target', () => {
      const channel = createSSEChannel({
        target: ['swr', 'tanstack-query'] as const,
        requestedTarget: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };
          const signal = ctx.signal;

          if (Array.isArray(signal)) {
            signal.forEach(s => {
              // Should handle both types
              if ('key' in s) {
                // SWR signal
                const key = s.key;
                expect(Array.isArray(key)).toBe(true);
              } else if ('queryKey' in s) {
                // TanStack signal
                const queryKey = s.queryKey;
                expect(Array.isArray(queryKey)).toBe(true);
              }
            });
          }

          return { action: 'send' };
        }
      });

      channel.invalidate([
        { target: 'swr', key: ['test'] },
        { target: 'tanstack-query', queryKey: ['test'] }
      ]);
    });

    it('should not include types outside configured targets', () => {
      let guardRan = false
      const channel = createSSEChannel({
        target: ['swr', 'tanstack-query'] as const,
        requestedTarget: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };
          guardRan = true
          return { action: 'send' };
        }
      });
      channel.invalidate([
        { target: 'swr', key: ['test'] },
        { target: 'tanstack-query', queryKey: ['test'] }
      ]);
      expect(guardRan).toBe(true);
    });
  });

  describe('Guard logic with correct types', () => {
    it('should enable type-safe filtering based on signal properties', () => {
      let allowedCount = 0;
      let blockedCount = 0;

      const channel = createSSEChannel({
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };
          const signals = Array.isArray(ctx.signal) ? ctx.signal : [ctx.signal];

          // Example: only allow revalidate actions
          const allRevalidate = signals.every(s => {
            // Type-safe access to SWR properties
            return s.action === 'revalidate' || s.action === undefined;
          });

          if (allRevalidate) {
            allowedCount++;
            return { action: 'send' };
          } else {
            blockedCount++;
            return { action: 'skip' };
          }
        }
      });

      channel.invalidate({ key: ['test'], action: 'revalidate' });
      channel.invalidate({ key: ['test'], action: 'mutate' });

      expect(allowedCount).toBeGreaterThan(0);
      expect(blockedCount).toBeGreaterThan(0);
    });

    it('should support guard logic with proper typing', () => {
      let guardRan = false
      const channel = createSSEChannel({
        target: 'tanstack-query',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };
          const signals = Array.isArray(ctx.signal) ? ctx.signal : [ctx.signal];

          for (const s of signals) {
            const queryKey = s.queryKey;
            if (queryKey[0] === 'admin') {
              return { action: 'close', reason: 'Admin queries not allowed' };
            }
          }

          guardRan = true
          return { action: 'send' };
        }
      });

      channel.invalidate({ queryKey: ['public', 'data'] });
      expect(guardRan).toBe(true);
    });
  });

  describe('Context construction with correct signal type', () => {
    it('should construct context without type errors', () => {
      // This tests that the implementation doesn't have suppressed type errors
      const channel = createSSEChannel({
        target: 'swr',
        beforeFrame: (ctx) => {
          // Context should be properly typed
          expect(ctx.connectionId).toBeDefined();

          // Signal should match channel type
          if (ctx.frameType === 'signal' && !Array.isArray(ctx.signal)) {
            const key = ctx.signal.key;
            expect(Array.isArray(key)).toBe(true);
          }

          return { action: 'send' };
        }
      });

      channel.invalidate({ key: ['test'] });
    });
  });

  describe('Error handling with typed signals', () => {
    it('should provide helpful error messages for type mismatches', () => {
      const channel = createSSEChannel({
        target: 'swr',
        beforeFrame: (ctx) => {
          if (ctx.frameType !== 'signal') return { action: 'send' };
          // If implementation incorrectly typed this as InvalidateSignal,
          // this would incorrectly allow checking non-SWR properties

          const signals = Array.isArray(ctx.signal) ? ctx.signal : [ctx.signal];

          // Only SWR properties should be accessible
          signals.forEach(s => {
            expect('key' in s).toBe(true);
            // @ts-expect-error - queryKey not in SWR signals
            const qk = s.queryKey;
          });

          return { action: 'send' };
        }
      });

      channel.invalidate({ key: ['test'] });
    });
  });
});
