/**
 * Gap 4: Single-target API types conflict with runtime behavior
 * 
 * Runtime auto-fills a missing signal target for single-target channels,
 * but the inferred channel type requires it. Docs/comments promise omission
 * is supported; the type does not match this contract.
 */

import { describe, it, expect } from 'vitest';
import { createSSEChannel } from '../../server/core/channel.js';
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal } from '../../types/protocol.js';

describe('Gap 4: Single-target API types vs runtime behavior', () => {
  describe('SWR single-target channel', () => {
    it('should accept signal without explicit target (runtime behavior)', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // Runtime auto-fills target, so this works
      expect(() => {
        channel.invalidate({ key: ['todos'] });
      }).not.toThrow();
    });

    it('should compile signal without explicit target', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // This should compile - target is optional for single-target channel
      channel.invalidate({ key: ['todos'] });
      
      // With action
      channel.invalidate({ key: ['todos'], action: 'revalidate' });
      
      // With optimisticData
      channel.invalidate({ 
        key: ['todos', 1], 
        action: 'mutate',
        optimisticData: { id: 1, done: true }
      });
    });

    it('should accept signal with explicit matching target', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // Explicit target matching channel config is valid
      expect(() => {
        channel.invalidate({ target: 'swr', key: ['users'] });
      }).not.toThrow();
    });

    it('should reject signal with conflicting explicit target', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // @ts-expect-error - Target conflicts with channel config
      channel.invalidate({ target: 'tanstack-query', queryKey: ['users'] });
      
      // Should also fail at runtime
      expect(() => {
        channel.invalidate({ 
          target: 'tanstack-query', 
          queryKey: ['users'] 
        } as any);
      }).toThrow();
    });

    it('should handle all SWR actions without explicit target', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // All should compile and work
      expect(() => {
        channel.invalidate({ key: ['/api/todos'], action: 'revalidate' });
      }).not.toThrow();
      
      expect(() => {
        channel.invalidate({ key: ['/api/users'], action: 'mutate' });
      }).not.toThrow();
      
      expect(() => {
        channel.invalidate({ key: ['/api/posts'], action: 'purge' });
      }).not.toThrow();
    });
  });

  describe('TanStack Query single-target channel', () => {
    it('should accept signal without explicit target', () => {
      const channel = createSSEChannel({ target: 'tanstack-query' });
      
      // Should compile
      channel.invalidate({ queryKey: ['todos'] });
      
      // Should not throw
      expect(() => {
        channel.invalidate({ queryKey: ['todos'] });
      }).not.toThrow();
    });

    it('should accept signal with explicit matching target', () => {
      const channel = createSSEChannel({ target: 'tanstack-query' });
      
      expect(() => {
        channel.invalidate({ target: 'tanstack-query', queryKey: ['users'] });
      }).not.toThrow();
    });

    it('should reject conflicting explicit target', () => {
      const channel = createSSEChannel({ target: 'tanstack-query' });
      
      // @ts-expect-error - Conflicting target
      channel.invalidate({ target: 'swr', key: ['users'] });
    });

    it('should handle all TanStack actions without explicit target', () => {
      const channel = createSSEChannel({ target: 'tanstack-query' });
      
      expect(() => {
        channel.invalidate({ queryKey: ['todos'], action: 'invalidate' });
      }).not.toThrow();
      
      expect(() => {
        channel.invalidate({ queryKey: ['users'], action: 'refetch' });
      }).not.toThrow();
      
      expect(() => {
        channel.invalidate({ queryKey: ['posts'], action: 'reset' });
      }).not.toThrow();
    });

    it('should handle exact and predicate options without explicit target', () => {
      const channel = createSSEChannel({ target: 'tanstack-query' });
      
      expect(() => {
        channel.invalidate({ queryKey: ['todos'], exact: true });
      }).not.toThrow();
      
      expect(() => {
        channel.invalidate({ queryKey: ['users'], predicate: true });
      }).not.toThrow();
    });
  });

  describe('RTK Query single-target channel', () => {
    it('should accept signal without explicit target', () => {
      const channel = createSSEChannel({ target: 'rtk-query' });
      
      // Should compile
      channel.invalidate({ tags: [{ type: 'Todo' }] });
      
      // Should not throw
      expect(() => {
        channel.invalidate({ tags: [{ type: 'Todo' }] });
      }).not.toThrow();
    });

    it('should accept signal with explicit matching target', () => {
      const channel = createSSEChannel({ target: 'rtk-query' });
      
      expect(() => {
        channel.invalidate({ 
          target: 'rtk-query', 
          tags: [{ type: 'User', id: 1 }] 
        });
      }).not.toThrow();
    });

    it('should reject conflicting explicit target', () => {
      const channel = createSSEChannel({ target: 'rtk-query' });
      
      // @ts-expect-error - Conflicting target
      channel.invalidate({ target: 'swr', key: ['users'] });
    });

    it('should handle various RTK tag formats without explicit target', () => {
      const channel = createSSEChannel({ target: 'rtk-query' });
      
      // Tag without ID
      expect(() => {
        channel.invalidate({ tags: [{ type: 'Post' }] });
      }).not.toThrow();
      
      // Tag with numeric ID
      expect(() => {
        channel.invalidate({ tags: [{ type: 'User', id: 42 }] });
      }).not.toThrow();
      
      // Tag with string ID
      expect(() => {
        channel.invalidate({ tags: [{ type: 'Item', id: 'uuid-123' }] });
      }).not.toThrow();
      
      // Multiple tags
      expect(() => {
        channel.invalidate({ 
          tags: [
            { type: 'Todo' },
            { type: 'User', id: 1 }
          ] 
        });
      }).not.toThrow();
    });
  });

  describe('Type inference for single-target channels', () => {
    it('should infer SWRSignal with optional target', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // Type should allow these formats
      const signal1 = { key: ['test'] };
      const signal2 = { target: 'swr' as const, key: ['test'] };
      
      channel.invalidate(signal1);
      channel.invalidate(signal2);
    });

    it('should infer TanStackQuerySignal with optional target', () => {
      const channel = createSSEChannel({ target: 'tanstack-query' });
      
      const signal1 = { queryKey: ['test'] };
      const signal2 = { target: 'tanstack-query' as const, queryKey: ['test'] };
      
      channel.invalidate(signal1);
      channel.invalidate(signal2);
    });

    it('should infer RTKQuerySignal with optional target', () => {
      const channel = createSSEChannel({ target: 'rtk-query' });
      
      const signal1 = { tags: [{ type: 'Test' }] };
      const signal2 = { target: 'rtk-query' as const, tags: [{ type: 'Test' }] };
      
      channel.invalidate(signal1);
      channel.invalidate(signal2);
    });
  });

  describe('Consistency across channel methods', () => {
    it('should support optional target in invalidate', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      channel.invalidate({ key: ['test'] });
      expect(true).toBe(true);
    });

    it('should support optional target when getting response', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      channel.invalidate({ key: ['test'] });
      const response = channel.createFetchResponse();
      
      expect(response).toBeDefined();
    });

    it('should support optional target with Node response', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      channel.invalidate({ key: ['test'] });
      
      // Node response attachment should work the same
      expect(() => {
        // Mock response object
        const mockRes = {
          writeHead: () => {},
          write: () => {},
          end: () => {}
        };
        channel.attachNodeResponse(mockRes as any);
      }).not.toThrow();
    });
  });

  describe('Batch operations with single-target channels', () => {
    it('should support batch without explicit targets', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // All signals in batch can omit target
      expect(() => {
        channel.invalidate([
          { key: ['todos'] },
          { key: ['users'] },
          { key: ['posts'] }
        ]);
      }).not.toThrow();
    });

    it('should support mixed explicit and implicit targets in batch', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      expect(() => {
        channel.invalidate([
          { key: ['todos'] }, // implicit
          { target: 'swr', key: ['users'] }, // explicit
          { key: ['posts'] } // implicit
        ]);
      }).not.toThrow();
    });

    it('should reject batch with conflicting explicit targets', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // @ts-expect-error - Conflicting target in batch
      channel.invalidate([
        { key: ['todos'] },
        { target: 'tanstack-query', queryKey: ['users'] }
      ]);
    });
  });

  describe('Documentation and type contract alignment', () => {
    it('should document that target is optional for single-target channels', () => {
      // This test documents the intended behavior
      // Types should allow omitting target when channel has single target
      
      const swrChannel = createSSEChannel({ target: 'swr' });
      swrChannel.invalidate({ key: ['test'] }); // ✓ should compile
      
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });
      tanstackChannel.invalidate({ queryKey: ['test'] }); // ✓ should compile
      
      const rtkChannel = createSSEChannel({ target: 'rtk-query' });
      rtkChannel.invalidate({ tags: [{ type: 'Test' }] }); // ✓ should compile
    });

    it('should document that explicit matching target is also valid', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // Both forms should be valid
      channel.invalidate({ key: ['test'] }); // implicit
      channel.invalidate({ target: 'swr', key: ['test'] }); // explicit
    });

    it('should document that conflicting targets are rejected', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // @ts-expect-error - This should not compile
      channel.invalidate({ target: 'tanstack-query', queryKey: ['test'] });
    });
  });

  describe('Edge cases', () => {
    it('should handle empty key arrays without target', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // Empty key might be invalid for other reasons, but target handling should be consistent
      expect(() => {
        channel.invalidate({ key: [] });
      }).not.toThrow(); // or should throw for empty key, but not for missing target
    });

    it('should handle undefined vs omitted target', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // Omitted target
      channel.invalidate({ key: ['test'] });
      
      // Explicit undefined might be treated differently
      channel.invalidate({ target: undefined, key: ['test'] } as any);
    });

    it('should maintain type safety with variable assignment', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      // Signal assigned to variable
      const signal = { key: ['test'] };
      channel.invalidate(signal);
      
      // With type annotation
      const typedSignal: SWRSignal = { key: ['test'] };
      channel.invalidate(typedSignal);
    });

    it('should work with spread operators', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      const baseSignal = { key: ['test'] };
      const enrichedSignal = { ...baseSignal, action: 'revalidate' as const };
      
      expect(() => {
        channel.invalidate(enrichedSignal);
      }).not.toThrow();
    });
  });

  describe('Comparison with multi-target channels', () => {
    it('should require explicit targets for multi-target channels', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      });
      
      // Multi-target requires explicit targets in batch
      channel.invalidate([
        { target: 'swr', key: ['test'] },
        { target: 'tanstack-query', queryKey: ['test'] }
      ]);
      
      // @ts-expect-error - Cannot omit target for multi-target
      channel.invalidate([
        { key: ['test'] },
        { queryKey: ['test'] }
      ]);
    });

    it('should show clear behavioral difference between single and multi-target', () => {
      // Single-target: target optional
      const singleTarget = createSSEChannel({ target: 'swr' });
      singleTarget.invalidate({ key: ['test'] }); // ✓
      
      // Multi-target: target required
      const multiTarget = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      });
      
      // @ts-expect-error - Must include target for each signal
      multiTarget.invalidate([
        { key: ['test'] },
        { queryKey: ['test'] }
      ]);
    });
  });
});
