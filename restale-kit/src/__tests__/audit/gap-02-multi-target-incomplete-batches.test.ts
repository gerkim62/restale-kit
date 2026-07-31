/**
 * Gap 2: Multi-target channels/groups accept incomplete batches
 * 
 * SignalInputForTarget allows any one member of the configured-target union,
 * but validateSignalTargets requires a multi-target invalidation to include
 * every configured target. This compiles but throws at runtime.
 */

import { describe, it, expect } from 'vitest';
import { createSSEChannel } from '../../server/core/channel.js';
import { SSEChannelGroup } from '../../server/core/channel-group.js';
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal } from '../../types/protocol.js';

describe('Gap 2: Multi-target channels accept incomplete batches', () => {
  describe('SSEChannel with literal multi-target configuration', () => {
    it('should reject single signal on multi-target channel at compile time', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const,
        requestedTarget: 'swr' 
      });
      
      // @ts-expect-error - Single signal not allowed for multi-target channel
      channel.invalidate({ target: 'swr', key: ['todos'] });
      
      // @ts-expect-error - Single signal not allowed for multi-target channel
      channel.invalidate({ target: 'tanstack-query', queryKey: ['todos'] });
    });

    it('should reject incomplete array at compile time', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const,
        requestedTarget: 'swr' 
      });
      
      // @ts-expect-error - Missing tanstack-query signal
      channel.invalidate([
        { target: 'swr', key: ['todos'] }
      ]);
      
      // @ts-expect-error - Missing swr signal
      channel.invalidate([
        { target: 'tanstack-query', queryKey: ['todos'] }
      ]);
    });

    it('should reject incomplete batch at runtime', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const,
        requestedTarget: 'swr' 
      });
      
      // Currently compiles but should throw
      expect(() => {
        channel.invalidate([
          { target: 'swr', key: ['todos'] }
        ] as any);
      }).toThrow(/ALL declared targets|all configured targets/i);
    });

    it('should accept complete batch with all configured targets', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const,
        requestedTarget: 'swr' 
      });
      
      // Should compile and succeed
      expect(() => {
        channel.invalidate([
          { target: 'swr', key: ['todos'] },
          { target: 'tanstack-query', queryKey: ['todos'] }
        ]);
      }).not.toThrow();
    });

    it('should enforce correct order independence for complete batches', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const,
        requestedTarget: 'swr' 
      });
      
      // Order shouldn't matter
      expect(() => {
        channel.invalidate([
          { target: 'tanstack-query', queryKey: ['users'] },
          { target: 'swr', key: ['/api/users'] }
        ]);
      }).not.toThrow();
    });
  });

  describe('SSEChannel with three-target configuration', () => {
    it('should reject incomplete batches with only one target', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query', 'rtk-query'] as const,
        requestedTarget: 'swr' 
      });
      
      // @ts-expect-error - Missing two targets
      channel.invalidate([
        { target: 'swr', key: ['todos'] }
      ]);
    });

    it('should reject incomplete batches with only two targets', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query', 'rtk-query'] as const,
        requestedTarget: 'swr' 
      });
      
      // @ts-expect-error - Missing rtk-query
      channel.invalidate([
        { target: 'swr', key: ['todos'] },
        { target: 'tanstack-query', queryKey: ['todos'] }
      ]);
      
      // @ts-expect-error - Missing tanstack-query
      channel.invalidate([
        { target: 'swr', key: ['todos'] },
        { target: 'rtk-query', tags: [{ type: 'Todo' }] }
      ]);
      
      // @ts-expect-error - Missing swr
      channel.invalidate([
        { target: 'tanstack-query', queryKey: ['todos'] },
        { target: 'rtk-query', tags: [{ type: 'Todo' }] }
      ]);
    });

    it('should accept complete batch with all three targets', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query', 'rtk-query'] as const,
        requestedTarget: 'swr' 
      });
      
      expect(() => {
        channel.invalidate([
          { target: 'swr', key: ['todos'] },
          { target: 'tanstack-query', queryKey: ['todos'] },
          { target: 'rtk-query', tags: [{ type: 'Todo' }] }
        ]);
      }).not.toThrow();
    });
  });

  describe('SSEChannelGroup.broadcast with multi-target', () => {
    it('should reject single signal on multi-target group', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >();
      
      group.register(createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      }), undefined);
      
      // @ts-expect-error - Single signal not allowed
      group.broadcast({ target: 'swr', key: ['todos'] });
    });

    it('should reject incomplete batch in broadcast', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >();
      
      group.register(createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      }), undefined);
      
      // @ts-expect-error - Incomplete batch
      group.broadcast([
        { target: 'swr', key: ['todos'] }
      ]);
    });

    it('should accept complete batch in broadcast', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >();
      
      group.register(createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      }), undefined);
      
      expect(() => {
        group.broadcast([
          { target: 'swr', key: ['todos'] },
          { target: 'tanstack-query', queryKey: ['todos'] }
        ]);
      }).not.toThrow();
    });
  });

  describe('SSEChannelGroup.broadcastToAll with multi-target', () => {
    it('should reject incomplete batch in broadcastToAll', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >();
      
      group.register(createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      }), undefined);
      group.register(createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      }), undefined);
      
      // @ts-expect-error - Incomplete batch
      group.broadcastToAll([
        { target: 'swr', key: ['users'] }
      ]);
    });

    it('should accept complete batch in broadcastToAll', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >();
      
      group.register(createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      }), undefined);
      group.register(createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      }), undefined);
      
      expect(() => {
        group.broadcastToAll([
          { target: 'swr', key: ['users'] },
          { target: 'tanstack-query', queryKey: ['users'] }
        ]);
      }).not.toThrow();
    });
  });

  describe('SSEChannelGroup.publish with multi-target', () => {
    it('should reject incomplete batch in publish', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >({
        pubsub: { type: 'memory' }
      });
      
      group.register(createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      }), undefined, {
        topics: ['updates']
      });
      
      // @ts-expect-error - Incomplete batch
      group.publish('updates', [
        { target: 'tanstack-query', queryKey: ['posts'] }
      ]);
    });

    it('should accept complete batch in publish', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >({
        pubsub: { type: 'memory' }
      });
      
      group.register(createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      }), undefined, {
        topics: ['updates']
      });
      
      expect(() => {
        group.publish('updates', [
          { target: 'swr', key: ['posts'] },
          { target: 'tanstack-query', queryKey: ['posts'] }
        ]);
      }).not.toThrow();
    });
  });

  describe('Runtime parity for tuple vs literal target configurations', () => {
    it('should enforce same rules for tuple types', () => {
      type MultiTarget = readonly ['swr', 'tanstack-query'];
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as MultiTarget,
        requestedTarget: 'swr'
      });
      
      // @ts-expect-error - Single signal not allowed
      channel.invalidate({ target: 'swr', key: ['test'] });
      
      // Should require complete batch
      expect(() => {
        channel.invalidate([
          { target: 'swr', key: ['test'] },
          { target: 'tanstack-query', queryKey: ['test'] }
        ]);
      }).not.toThrow();
    });

    it('should handle const assertions consistently', () => {
      const targets = ['swr', 'rtk-query'] as const;
      const channel = createSSEChannel({ target: targets, requestedTarget: 'swr' });
      
      // @ts-expect-error - Incomplete batch
      channel.invalidate([
        { target: 'swr', key: ['items'] }
      ]);
      
      // Complete batch should work
      expect(() => {
        channel.invalidate([
          { target: 'swr', key: ['items'] },
          { target: 'rtk-query', tags: [{ type: 'Item' }] }
        ]);
      }).not.toThrow();
    });
  });

  describe('Mixed single and multi-target groups', () => {
    it('should handle groups with both single and multi-target channels', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >();
      
      // Single-target channel
      group.register(createSSEChannel({ target: 'swr' }), {});
      
      // Multi-target channel
      group.register(createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const,
        requestedTarget: 'swr'
      }), {});
      
      group.broadcast({ target: 'swr', key: ['test'] }, () => true);
      
      // Multi-target channel in group needs special handling
      // This is a complex scenario that needs clear type guidance
    });
  });

  describe('Edge cases', () => {
    it('should reject duplicate signals in batch', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      });
      
      // Even if count matches, duplicates are invalid
      expect(() => {
        channel.invalidate([
          { target: 'swr', key: ['todos'] },
          { target: 'swr', key: ['users'] }
        ] as any);
      }).toThrow();
    });

    it('should reject batch with extra signals beyond configured targets', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      });
      
      // Three signals when only two targets configured
      expect(() => {
        channel.invalidate([
          { target: 'swr', key: ['todos'] },
          { target: 'tanstack-query', queryKey: ['todos'] },
          { target: 'rtk-query', tags: [{ type: 'Todo' }] }
        ] as any);
      }).toThrow();
    });

    it('should handle empty batch gracefully', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const 
      });
      
      expect(() => {
        channel.invalidate([] as any);
      }).toThrow();
    });
  });
});
