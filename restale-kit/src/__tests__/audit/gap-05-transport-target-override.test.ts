/**
 * Gap 5: Channel/group transport setup can override the group's typed target
 * 
 * ChannelSetupOptions is independent of the group's TSignal/TTarget. A group
 * typed as SWR can create a TanStack channel but return it as SSEChannel<SWRSignal>.
 * This breaks type safety at the transport setup boundary.
 */

import { describe, it, expect } from 'vitest';
import { SSEChannelGroup } from '../../server/core/channel-group.js';
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal } from '../../types/protocol.js';

describe('Gap 5: Transport setup target override', () => {
  describe('SSEChannelGroup.createFetchResponse', () => {
    it('should reject mismatched target in createFetchResponse', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse');
      
      // @ts-expect-error - TanStack target conflicts with SWR group
      group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      
      // @ts-expect-error - RTK target conflicts with SWR group
      group.createFetchResponse(mockReq, { target: 'rtk-query' });
    });

    it('should accept matching target in createFetchResponse', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse');
      
      // Should compile - target matches group type
      const channel = group.createFetchResponse(mockReq, { target: 'swr' });
      
      expect(channel).toBeDefined();
    });

    it('should accept omitted target when group has default', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse');
      
      // Omitting target should use group default
      const channel = group.createFetchResponse(mockReq, {});
      
      expect(channel).toBeDefined();
    });

    it('should enforce type safety for multi-target groups', () => {
      const group = new SSEChannelGroup<SWRSignal | TanStackQuerySignal>({
        target: ['swr', 'tanstack-query'] as const
      });
      
      const mockReq = new Request('http://localhost/sse');
      
      // Valid targets
      group.createFetchResponse(mockReq, { target: 'swr' });
      group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      group.createFetchResponse(mockReq, { target: ['swr', 'tanstack-query'] as const });
      
      // @ts-expect-error - Invalid target
      group.createFetchResponse(mockReq, { target: 'rtk-query' });
    });
  });

  describe('SSEChannelGroup.attachNodeResponse', () => {
    it('should reject mismatched target in attachNodeResponse', () => {
      const group = new SSEChannelGroup<TanStackQuerySignal>({ 
        target: 'tanstack-query' 
      });
      
      const mockReq = { headers: {} };
      const mockRes = {
        writeHead: () => {},
        write: () => {},
        end: () => {}
      };
      
      // @ts-expect-error - SWR target conflicts with TanStack group
      group.attachNodeResponse(mockReq as any, mockRes as any, { 
        target: 'swr' 
      });
      
      // @ts-expect-error - RTK target conflicts with TanStack group
      group.attachNodeResponse(mockReq as any, mockRes as any, { 
        target: 'rtk-query' 
      });
    });

    it('should accept matching target in attachNodeResponse', () => {
      const group = new SSEChannelGroup<TanStackQuerySignal>({ 
        target: 'tanstack-query' 
      });
      
      const mockReq = { headers: {} };
      const mockRes = {
        writeHead: () => {},
        write: () => {},
        end: () => {}
      };
      
      // Should compile
      const channel = group.attachNodeResponse(
        mockReq as any, 
        mockRes as any, 
        { target: 'tanstack-query' }
      );
      
      expect(channel).toBeDefined();
    });

    it('should use group default when target omitted', () => {
      const group = new SSEChannelGroup<RTKQuerySignal>({ 
        target: 'rtk-query' 
      });
      
      const mockReq = { headers: {} };
      const mockRes = {
        writeHead: () => {},
        write: () => {},
        end: () => {}
      };
      
      const channel = group.attachNodeResponse(
        mockReq as any, 
        mockRes as any, 
        {}
      );
      
      expect(channel).toBeDefined();
    });
  });

  describe('Type safety across setup methods', () => {
    it('should maintain consistent typing between createFetchResponse and attachNodeResponse', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      // Both methods should have same type constraints
      const mockReq = new Request('http://localhost/sse');
      const mockNodeReq = { headers: {} };
      const mockNodeRes = {
        writeHead: () => {},
        write: () => {},
        end: () => {}
      };
      
      // Valid for both
      const fetchChannel = group.createFetchResponse(mockReq, { target: 'swr' });
      const nodeChannel = group.attachNodeResponse(
        mockNodeReq as any,
        mockNodeRes as any,
        { target: 'swr' }
      );
      
      // @ts-expect-error - Invalid for both
      group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      
      // @ts-expect-error - Invalid for both
      group.attachNodeResponse(
        mockNodeReq as any,
        mockNodeRes as any,
        { target: 'tanstack-query' }
      );
    });
  });

  describe('Returned channel type safety', () => {
    it('should return correctly typed channel from createFetchResponse', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse');
      const channel = group.createFetchResponse(mockReq, { target: 'swr' });
      
      // Channel should be typed as SSEChannel<SWRSignal>
      // Should accept SWR signals
      channel.invalidate({ target: 'swr', key: ['test'] });
      
      // @ts-expect-error - Should reject TanStack signals
      channel.invalidate({ target: 'tanstack-query', queryKey: ['test'] });
    });

    it('should return correctly typed channel from attachNodeResponse', () => {
      const group = new SSEChannelGroup<TanStackQuerySignal>({ 
        target: 'tanstack-query' 
      });
      
      const mockReq = { headers: {} };
      const mockRes = {
        writeHead: () => {},
        write: () => {},
        end: () => {}
      };
      
      const channel = group.attachNodeResponse(
        mockReq as any,
        mockRes as any,
        { target: 'tanstack-query' }
      );
      
      // Should accept TanStack signals
      channel.invalidate({ target: 'tanstack-query', queryKey: ['test'] });
      
      // @ts-expect-error - Should reject SWR signals
      channel.invalidate({ target: 'swr', key: ['test'] });
    });
  });

  describe('Setup options beyond target', () => {
    it('should validate topics alongside target', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        target: 'swr',
        pubsub: { type: 'memory' }
      });
      
      const mockReq = new Request('http://localhost/sse');
      
      // Valid: matching target with topics
      group.createFetchResponse(mockReq, {
        target: 'swr',
        topics: ['updates']
      });
      
      // @ts-expect-error - Invalid target even with valid topics
      group.createFetchResponse(mockReq, {
        target: 'tanstack-query',
        topics: ['updates']
      });
    });

    it('should validate other options with type-safe target', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse');
      
      // All these options should work with correct target
      group.createFetchResponse(mockReq, {
        target: 'swr',
        capacity: 100,
        keepaliveIntervalMs: 30000
      });
      
      // @ts-expect-error - Wrong target invalidates entire setup
      group.createFetchResponse(mockReq, {
        target: 'rtk-query',
        capacity: 100
      });
    });
  });

  describe('Edge cases with group typing', () => {
    it('should handle union signal types in group', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >();
      
      const mockReq = new Request('http://localhost/sse');
      
      // Should accept either target from the union
      group.createFetchResponse(mockReq, { target: 'swr' });
      group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      
      // @ts-expect-error - RTK not in union
      group.createFetchResponse(mockReq, { target: 'rtk-query' });
    });

    it('should prevent widening to generic InvalidateSignal', () => {
      // Group should maintain specific signal type, not widen
      const swrGroup = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse');
      
      // @ts-expect-error - Cannot override to different specific type
      swrGroup.createFetchResponse(mockReq, { target: 'tanstack-query' });
      
      // The returned channel must respect the group's signal type
      const channel = swrGroup.createFetchResponse(mockReq, { target: 'swr' });
      
      // @ts-expect-error - Channel is typed for SWR, not generic
      channel.invalidate({ target: 'tanstack-query', queryKey: ['test'] });
    });
  });

  describe('Runtime validation matches type validation', () => {
    it('should throw at runtime for type-mismatched target', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse');
      
      // Should throw when type-checking is bypassed
      expect(() => {
        group.createFetchResponse(mockReq, { 
          target: 'tanstack-query' 
        } as any);
      }).toThrow(/target/i);
    });

    it('should validate target compatibility in Node transport', () => {
      const group = new SSEChannelGroup<TanStackQuerySignal>({ 
        target: 'tanstack-query' 
      });
      
      const mockReq = { headers: {} };
      const mockRes = {
        writeHead: () => {},
        write: () => {},
        end: () => {}
      };
      
      expect(() => {
        group.attachNodeResponse(
          mockReq as any,
          mockRes as any,
          { target: 'swr' } as any
        );
      }).toThrow(/target/i);
    });
  });

  describe('Multi-target group setup', () => {
    it('should allow any configured target in setup', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal | RTKQuerySignal
      >({
        target: ['swr', 'tanstack-query', 'rtk-query'] as const
      });
      
      const mockReq = new Request('http://localhost/sse');
      
      // Each individual target should be allowed
      expect(() => {
        group.createFetchResponse(mockReq, { target: 'swr' });
      }).not.toThrow();
      
      expect(() => {
        group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      }).not.toThrow();
      
      expect(() => {
        group.createFetchResponse(mockReq, { target: 'rtk-query' });
      }).not.toThrow();
    });

    it('should allow multi-target setup matching group config', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >({
        target: ['swr', 'tanstack-query'] as const
      });
      
      const mockReq = new Request('http://localhost/sse');
      
      // Can create channel with same multi-target config
      expect(() => {
        group.createFetchResponse(mockReq, { 
          target: ['swr', 'tanstack-query'] as const 
        });
      }).not.toThrow();
    });

    it('should reject target subset that excludes group targets', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal | RTKQuerySignal
      >({
        target: ['swr', 'tanstack-query', 'rtk-query'] as const
      });
      
      const mockReq = new Request('http://localhost/sse');
      
      // Individual targets from the set are fine
      group.createFetchResponse(mockReq, { target: 'swr' });
      
      // But adding a target outside the group should fail
      // @ts-expect-error - Generic signal not in configured union
      group.createFetchResponse(mockReq, { target: 'unknown' });
    });
  });

  describe('Interaction with channelDefaults', () => {
    it('should respect group-level defaults in transport setup', () => {
      const group = new SSEChannelGroup<SWRSignal>({ 
        target: 'swr',
        channelDefaults: {
          capacity: 50
        }
      });
      
      const mockReq = new Request('http://localhost/sse');
      
      // Setup with matching target should inherit defaults
      const channel = group.createFetchResponse(mockReq, { 
        target: 'swr' 
      });
      
      expect(channel).toBeDefined();
      
      // @ts-expect-error - Mismatched target ignores defaults
      group.createFetchResponse(mockReq, { target: 'tanstack-query' });
    });

    it('should not allow setup to override group target via defaults', () => {
      const group = new SSEChannelGroup<SWRSignal>({ 
        target: 'swr',
        channelDefaults: {
          target: 'swr'
        }
      });
      
      const mockReq = new Request('http://localhost/sse');
      
      // @ts-expect-error - Cannot override group target constraint
      group.createFetchResponse(mockReq, { target: 'tanstack-query' });
    });
  });
});
