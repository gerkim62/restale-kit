/**
 * Gap 8: Adapter generic parameters are not tied to their adapter target
 * 
 * tanstackQueryAdapter and swrAdapter accept any TSignal extends InvalidateSignal.
 * This compiles:
 *   tanstackQueryAdapter<SWRSignal>(queryClient)
 *   swrAdapter<TanStackQuerySignal>(mutate)
 * 
 * Both callbacks are branded for one target but silently ignore their own
 * declared input at runtime.
 */

import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { tanstackQueryAdapter } from '../../client/tanstack-query/adapter.js';
import { swrAdapter, type SWRMutator } from '../../client/swr/adapter.js';
import { rtkQueryAdapter } from '../../client/rtk-query/adapter.js';
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal } from '../../types/protocol.js';

function createMockMutate(): SWRMutator {
  const fn = (matcher: (key?: unknown) => boolean) => Promise.resolve([]);
  return fn as SWRMutator;
}

describe('Gap 8: Adapter generic parameters tied to target', () => {
  describe('tanstackQueryAdapter type safety', () => {
    it('should reject SWRSignal type argument', () => {
      const queryClient = {} as any;
      
      // @ts-expect-error - SWR signals not compatible with TanStack adapter
      const adapter = tanstackQueryAdapter<SWRSignal>(queryClient);
    });

    it('should reject RTKQuerySignal type argument', () => {
      const queryClient = {} as any;
      
      // @ts-expect-error - RTK signals not compatible with TanStack adapter
      const adapter = tanstackQueryAdapter<RTKQuerySignal>(queryClient);
    });

    it('should accept TanStackQuerySignal type argument', () => {
      const queryClient = {} as any;
      
      // Should compile
      const adapter = tanstackQueryAdapter<TanStackQuerySignal>(queryClient);
      
      expect(adapter).toBeDefined();
      expect(adapter.target).toBe('tanstack-query');
    });

    it('should accept custom signal extending TanStackQuerySignal', () => {
      const queryClient = {} as any;
      
      // Custom signal that extends TanStack signal
      interface CustomTanStackSignal extends TanStackQuerySignal {
        customField?: string;
      }
      
      // Should compile - custom type extends TanStack
      const adapter = tanstackQueryAdapter<CustomTanStackSignal>(queryClient);
      
      expect(adapter).toBeDefined();
    });

    it('should reject custom signal not extending TanStackQuerySignal', () => {
      const queryClient = {} as any;
      
      interface CustomSignal {
        target: 'custom';
        data: unknown;
      }
      
      // @ts-expect-error - Custom signal doesn't extend TanStack
      const adapter = tanstackQueryAdapter<CustomSignal>(queryClient);
    });
  });

  describe('swrAdapter type safety', () => {
    it('should reject TanStackQuerySignal type argument', () => {
      const mutate = (() => Promise.resolve([])) as any;

      // @ts-expect-error - TanStack signals not compatible with SWR adapter
      const adapter = swrAdapter<TanStackQuerySignal>(mutate);
    });

    it('should reject RTKQuerySignal type argument', () => {
      const mutate = (() => Promise.resolve([])) as any;

      // @ts-expect-error - RTK signals not compatible with SWR adapter
      const adapter = swrAdapter<RTKQuerySignal>(mutate);
    });

    it('should accept SWRSignal type argument', () => {
      const mutate = (() => Promise.resolve([])) as any;

      // Should compile
      const adapter = swrAdapter<SWRSignal>(mutate);

      expect(adapter).toBeDefined();
      expect(adapter.target).toBe('swr');
    });

    it('should accept custom signal extending SWRSignal', () => {
      const mutate = (() => Promise.resolve([])) as any;

      interface CustomSWRSignal extends SWRSignal {
        metadata?: Record<string, unknown>;
      }

      // Should compile - custom type extends SWR
      const adapter = swrAdapter<CustomSWRSignal>(mutate);

      expect(adapter).toBeDefined();
    });

    it('should reject custom signal not extending SWRSignal', () => {
      const mutate = (() => Promise.resolve([])) as any;
      
      interface UnrelatedSignal {
        target: 'other';
        payload: string;
      }
      
      // @ts-expect-error - Custom signal doesn't extend SWR
      const adapter = swrAdapter<UnrelatedSignal>(mutate);
    });
  });

  describe('rtkQueryAdapter type safety', () => {
    it('should reject SWRSignal type argument', () => {
      const mockApi = {
        util: {
          invalidateTags: () => {}
        }
      };
      
      // @ts-expect-error - SWR signals not compatible with RTK adapter
      const adapter = rtkQueryAdapter<SWRSignal>(mockApi as any);
    });

    it('should reject TanStackQuerySignal type argument', () => {
      const mockApi = {
        util: {
          invalidateTags: () => {}
        }
      };
      
      // @ts-expect-error - TanStack signals not compatible with RTK adapter
      const adapter = rtkQueryAdapter<TanStackQuerySignal>(mockApi as any);
    });

    it('should accept RTKQuerySignal type argument', () => {
      const mockApi = {
        util: {
          invalidateTags: () => {}
        }
      };
      
      // Should compile
      const adapter = rtkQueryAdapter<RTKQuerySignal>(mockApi as any);
      
      expect(adapter).toBeDefined();
      expect(adapter.target).toBe('rtk-query');
    });

    it('should accept custom signal extending RTKQuerySignal', () => {
      const mockApi = {
        util: {
          invalidateTags: () => {}
        }
      };
      
      interface CustomRTKSignal extends RTKQuerySignal {
        priority?: number;
      }
      
      // Should compile - custom type extends RTK
      const adapter = rtkQueryAdapter<CustomRTKSignal>(mockApi as any);
      
      expect(adapter).toBeDefined();
    });
  });

  describe('Adapter callback branding', () => {
    it('should brand TanStack callback with correct signal type', () => {
      const queryClient = { invalidateQueries: () => Promise.resolve() } as any;
      const callback = tanstackQueryAdapter(queryClient);

      // Should handle TanStack signal
      callback({ target: 'tanstack-query', queryKey: ['test'] });

      // @ts-expect-error - Callback branded for TanStack, not SWR
      callback({ target: 'swr', key: ['test'] });
    });

    it('should brand SWR callback with correct signal type', () => {
      const mutate = (() => Promise.resolve([])) as any;
      const callback = swrAdapter(mutate);

      // Should handle SWR signal
      callback({ target: 'swr', key: ['test'] });

      // @ts-expect-error - Callback branded for SWR, not TanStack
      callback({ target: 'tanstack-query', queryKey: ['test'] });
    });

    it('should brand RTK callback with correct signal type', () => {
      const mockApi = {
        util: {
          invalidateTags: () => {}
        }
      };
      const callback = rtkQueryAdapter(mockApi as any);

      // Should handle RTK signal
      callback({ target: 'rtk-query', tags: [{ type: 'Test' }] });

      // @ts-expect-error - Callback branded for RTK, not SWR
      callback({ target: 'swr', key: ['test'] });
    });
  });

  describe('Generic type parameter constraints', () => {
    it('should enforce extends constraint on TanStack adapter', () => {
      const queryClient = { invalidateQueries: () => Promise.resolve() } as any;

      type BadType = { foo: string };
      // @ts-expect-error - Plain object doesn't extend TanStackQuerySignal
      const adapter = tanstackQueryAdapter<BadType>(queryClient);
    });

    it('should enforce extends constraint on SWR adapter', () => {
      const mutate = () => {};

      type BadType = { bar: number };
      // @ts-expect-error - Plain object doesn't extend SWRSignal
      const adapter = swrAdapter<BadType>(mutate);
    });

    it('should enforce extends constraint on RTK adapter', () => {
      const mockApi = {
        util: {
          invalidateTags: () => {}
        }
      };

      type BadType = { baz: boolean };
      // @ts-expect-error - Plain object doesn't extend RTKQuerySignal
      const adapter = rtkQueryAdapter<BadType>(mockApi as any);
    });
  });

  describe('Runtime behavior matches type constraints', () => {
    it('should process TanStack signals correctly', () => {
      const queryClient = { invalidateQueries: () => Promise.resolve() } as any;
      const adapter = tanstackQueryAdapter(queryClient);

      const signal: TanStackQuerySignal = {
        target: 'tanstack-query',
        queryKey: ['users', 'list']
      };

      expect(() => {
        adapter(signal);
      }).not.toThrow();
    });

    it('should process SWR signals correctly', () => {
      let called = false;
      const mutate = ((filter: any) => { called = true; return Promise.resolve([]); }) as any;
      const adapter = swrAdapter(mutate);

      const signal: SWRSignal = {
        target: 'swr',
        key: ['/api/users']
      };

      adapter(signal);
      expect(called).toBe(true);
    });

    it('should process RTK signals correctly', () => {
      let calledTags: any[] = [];
      const mockApi = {
        util: {
          invalidateTags: (tags: any[]) => {
            calledTags = tags;
          }
        }
      };

      const adapter = rtkQueryAdapter(mockApi as any);

      const signal: RTKQuerySignal = {
        target: 'rtk-query',
        tags: [{ type: 'User', id: 1 }]
      };

      adapter(signal);
      expect(calledTags).toHaveLength(1);
    });
  });

  describe('Custom signal extensions', () => {
    it('should allow extending TanStack signal with additional properties', () => {
      const queryClient = { invalidateQueries: () => Promise.resolve() } as any;

      interface ExtendedTanStackSignal extends TanStackQuerySignal {
        priority?: 'high' | 'low';
        source?: string;
      }

      const adapter = tanstackQueryAdapter<ExtendedTanStackSignal>(queryClient);

      const signal: ExtendedTanStackSignal = {
        target: 'tanstack-query',
        queryKey: ['users'],
        priority: 'high',
        source: 'webhook'
      };

      expect(() => {
        adapter(signal);
      }).not.toThrow();
    });

    it('should allow extending SWR signal with metadata', () => {
      const mutate = (() => Promise.resolve([])) as any;

      interface ExtendedSWRSignal extends SWRSignal {
        timestamp?: number;
        reason?: string;
      }

      const adapter = swrAdapter<ExtendedSWRSignal>(mutate);

      const signal: ExtendedSWRSignal = {
        target: 'swr',
        key: ['/api/posts'],
        timestamp: Date.now(),
        reason: 'user action'
      };

      adapter(signal);
    });

    it('should require extended signal to maintain base properties', () => {
      const queryClient = {} as any;
      
      interface BrokenExtension {
        // Missing required TanStack properties
        customProp: string;
      }
      
      // @ts-expect-error - Doesn't extend TanStackQuerySignal properly
      const adapter = tanstackQueryAdapter<BrokenExtension>(queryClient);
    });
  });

  describe('Cross-adapter type isolation', () => {
    it('should not allow using TanStack adapter with SWR signal type', () => {
      const queryClient = {} as any;
      
      // This should fail at type level
      // @ts-expect-error
      const badAdapter = tanstackQueryAdapter<SWRSignal>(queryClient);
    });

    it('should not allow using SWR adapter with TanStack signal type', () => {
      const mutate = (() => Promise.resolve([])) as any;

      // @ts-expect-error
      const badAdapter = swrAdapter<TanStackQuerySignal>(mutate);
    });

    it('should maintain type safety in adapter composition', () => {
      const queryClient = {} as any;
      const mutate = (() => Promise.resolve([])) as any;

      const tanstackAdapter = tanstackQueryAdapter(queryClient);
      const swrAdapterInstance = swrAdapter(mutate);
      
      // Adapters should not be interchangeable
      // @ts-expect-error - Different target types
      const confused: typeof tanstackAdapter = swrAdapterInstance;
    });
  });
});
