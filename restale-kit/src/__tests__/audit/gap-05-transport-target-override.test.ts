/**
 * Gap 5: Channel/group transport setup can override the group's typed target
 * 
 * ChannelSetupOptions is independent of the group's TSignal/TTarget. A group
 * typed as SWR can create a TanStack channel but return it as SSEChannel<SWRSignal>.
 * This breaks type safety at the transport setup boundary.
 */

import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { describe, it, expect, vi } from 'vitest';
import { SSEChannelGroup } from '../../server/core/channel-group.js';
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal } from '../../types/protocol.js';

function createMockResponse(): ServerResponse {
  const res = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as unknown as ServerResponse;
  res.writeHead = vi.fn() as any;
  return res;
}

describe('Gap 5: Transport setup target override', () => {
  describe('SSEChannelGroup.createFetchResponse', () => {
    it('should reject mismatched target in createFetchResponse', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      expect(() => {
        // @ts-expect-error - TanStack target conflicts with SWR group
        group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      }).toThrow();
      
      expect(() => {
        // @ts-expect-error - RTK target conflicts with SWR group
        group.createFetchResponse(mockReq, { target: 'rtk-query' });
      }).toThrow();
    });

    it('should accept matching target in createFetchResponse', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      // Should compile - target matches group type
      expect(() => {
        const result = group.createFetchResponse(mockReq, { target: 'swr' });
        expect(result).toBeDefined();
        expect(result.channel).toBeDefined();
        expect(result.response).toBeDefined();
      }).not.toThrow();
    });

    it('should accept omitted target when group has default', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      // Omitting target should use group default
      expect(() => {
        const result = group.createFetchResponse(mockReq, {});
        expect(result).toBeDefined();
        expect(result.channel).toBeDefined();
      }).not.toThrow();
    });

    it('should enforce type safety for multi-target groups', () => {
      const group = new SSEChannelGroup<SWRSignal | TanStackQuerySignal>({
        target: ['swr', 'tanstack-query'] as const
      });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      // Valid targets
      expect(() => {
        group.createFetchResponse(mockReq, { target: 'swr' });
      }).not.toThrow();
      
      expect(() => {
        group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      }).not.toThrow();
      
      expect(() => {
        group.createFetchResponse(mockReq, { target: ['swr', 'tanstack-query'] as const });
      }).not.toThrow();
      
      expect(() => {
        // @ts-expect-error - Invalid target
        group.createFetchResponse(mockReq, { target: 'rtk-query' });
      }).toThrow();
    });
  });

  describe('SSEChannelGroup.attachNodeResponse', () => {
    it('should reject mismatched target in attachNodeResponse', () => {
      const group = new SSEChannelGroup<TanStackQuerySignal>({ 
        target: 'tanstack-query' 
      });
      
      const mockReq = new EventEmitter() as any;
      mockReq.url = '/sse?__restale_cid__=conn-1';
      mockReq.headers = {};
      
      const mockRes = createMockResponse();
      
      expect(() => {
        // @ts-expect-error - SWR target conflicts with TanStack group
        group.attachNodeResponse(mockReq, mockRes, { target: 'swr' });
      }).toThrow();
      
      expect(() => {
        // @ts-expect-error - RTK target conflicts with TanStack group
        group.attachNodeResponse(mockReq, mockRes, { target: 'rtk-query' });
      }).toThrow();
    });

    it('should accept matching target in attachNodeResponse', () => {
      const group = new SSEChannelGroup<TanStackQuerySignal>({ 
        target: 'tanstack-query' 
      });
      
      const mockReq = new EventEmitter() as any;
      mockReq.url = '/sse?__restale_cid__=conn-1';
      mockReq.headers = {};
      
      const mockRes = createMockResponse();
      
      // Should compile
      expect(() => {
        const result = group.attachNodeResponse(mockReq, mockRes, { target: 'tanstack-query' });
        expect(result).toBeDefined();
        expect(result.channel).toBeDefined();
      }).not.toThrow();
    });

    it('should use group default when target omitted', () => {
      const group = new SSEChannelGroup<RTKQuerySignal>({ 
        target: 'rtk-query' 
      });
      
      const mockReq = new EventEmitter() as any;
      mockReq.url = '/sse?__restale_cid__=conn-1';
      mockReq.headers = {};
      
      const mockRes = createMockResponse();
      
      expect(() => {
        const result = group.attachNodeResponse(mockReq, mockRes, {});
        expect(result).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('Type safety across setup methods', () => {
    it('should maintain consistent typing between createFetchResponse and attachNodeResponse', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      // Both methods should have same type constraints
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      const mockNodeReq = new EventEmitter() as any;
      mockNodeReq.url = '/sse?__restale_cid__=conn-1';
      mockNodeReq.headers = {};
      
      const mockNodeRes = new EventEmitter() as any;
      mockNodeRes.writeHead = () => {};
      mockNodeRes.write = () => {};
      mockNodeRes.end = () => {};
      
      // Valid for both
      expect(() => {
        const fetchResult = group.createFetchResponse(mockReq, { target: 'swr' });
        expect(fetchResult.channel).toBeDefined();
      }).not.toThrow();
      
      expect(() => {
        const nodeResult = group.attachNodeResponse(mockNodeReq, mockNodeRes, { target: 'swr' });
        expect(nodeResult.channel).toBeDefined();
      }).not.toThrow();
      
      expect(() => {
        // @ts-expect-error - Invalid for both
        group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      }).toThrow();
      
      expect(() => {
        // @ts-expect-error - Invalid for both
        group.attachNodeResponse(mockNodeReq, mockNodeRes, { target: 'tanstack-query' });
      }).toThrow();
    });
  });

  describe('Returned channel type safety', () => {
    it('should return correctly typed channel from createFetchResponse', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      const { channel } = group.createFetchResponse(mockReq, { target: 'swr' });
      
      // Channel should be typed as SSEChannel<SWRSignal>
      // Should accept SWR signals
      expect(() => {
        channel.invalidate({ target: 'swr', key: ['test'] });
      }).not.toThrow();
      
      expect(() => {
        // @ts-expect-error - Should reject TanStack signals
        channel.invalidate({ target: 'tanstack-query', queryKey: ['test'] });
      }).toThrow();
    });

    it('should return correctly typed channel from attachNodeResponse', () => {
      const group = new SSEChannelGroup<TanStackQuerySignal>({ 
        target: 'tanstack-query' 
      });
      
      const mockReq = new EventEmitter() as any;
      mockReq.url = '/sse?__restale_cid__=conn-1';
      mockReq.headers = {};
      
      const mockRes = createMockResponse();
      
      const { channel } = group.attachNodeResponse(mockReq, mockRes, { target: 'tanstack-query' });
      
      // Should accept TanStack signals
      expect(() => {
        channel.invalidate({ target: 'tanstack-query', queryKey: ['test'] });
      }).not.toThrow();
      
      expect(() => {
        // @ts-expect-error - Should reject SWR signals
        channel.invalidate({ target: 'swr', key: ['test'] });
      }).toThrow();
    });
  });

  describe('Setup options beyond target', () => {
    it('should validate topics alongside target', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        target: 'swr',
        pubsub: { type: 'memory' }
      });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      // Valid: matching target with topics
      expect(() => {
        group.createFetchResponse(mockReq, {
          target: 'swr',
          topics: ['updates']
        });
      }).not.toThrow();
      
      expect(() => {
        group.createFetchResponse(mockReq, {
          // @ts-expect-error - Invalid target even with valid topics
          target: 'tanstack-query',
          topics: ['updates']
        });
      }).toThrow();
    });

    it('should validate other options with type-safe target', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      // All these options should work with correct target
      expect(() => {
        group.createFetchResponse(mockReq, {
          target: 'swr',
          eventBufferCapacity: 100,
          keepaliveIntervalMs: 30000
        });
      }).not.toThrow();
      
      expect(() => {
        group.createFetchResponse(mockReq, {
          // @ts-expect-error - Wrong target invalidates entire setup
          target: 'rtk-query',
          eventBufferCapacity: 100
        });
      }).toThrow();
    });
  });

  describe('Edge cases with group typing', () => {
    it('should handle union signal types in group', () => {
      const group = new SSEChannelGroup<
        SWRSignal | TanStackQuerySignal
      >({ target: ['swr', 'tanstack-query'] });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      // Should accept either target from the union
      expect(() => {
        group.createFetchResponse(mockReq, { target: 'swr' });
      }).not.toThrow();
      
      expect(() => {
        group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      }).not.toThrow();
      
      expect(() => {
        // @ts-expect-error - RTK not in union
        group.createFetchResponse(mockReq, { target: 'rtk-query' });
      }).toThrow();
    });

    it('should prevent widening to generic InvalidateSignal', () => {
      // Group should maintain specific signal type, not widen
      const swrGroup = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      expect(() => {
        // @ts-expect-error - Cannot override to different specific type
        swrGroup.createFetchResponse(mockReq, { target: 'tanstack-query' });
      }).toThrow();
      
      // The returned channel must respect the group's signal type
      const { channel } = swrGroup.createFetchResponse(mockReq, { target: 'swr' });
      
      expect(() => {
        // @ts-expect-error - Channel is typed for SWR, not generic
        channel.invalidate({ target: 'tanstack-query', queryKey: ['test'] });
      }).toThrow();
    });
  });

  describe('Runtime validation matches type validation', () => {
    it('should throw at runtime for type-mismatched target', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
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
      
      const mockReq = new EventEmitter() as any;
      mockReq.url = '/sse?__restale_cid__=conn-1';
      mockReq.headers = {};
      
      const mockRes = createMockResponse();
      
      expect(() => {
        group.attachNodeResponse(mockReq, mockRes, { target: 'swr' } as any);
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
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
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
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
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
        target: ['swr', 'tanstack-query', 'rtk-query']
      });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      // Individual targets from the set are fine
      expect(() => {
        group.createFetchResponse(mockReq, { target: 'swr' });
      }).not.toThrow();
      
      // But adding a target outside the group should fail
      expect(() => {
        // @ts-expect-error - Generic signal not in configured union
        group.createFetchResponse(mockReq, { target: 'unknown' });
      }).toThrow();
    });
  });

  describe('Interaction with channelDefaults', () => {
    it('should respect group-level defaults in transport setup', () => {
      const group = new SSEChannelGroup<SWRSignal>({ 
        target: 'swr',
        channelDefaults: {
          eventBufferCapacity: 50
        }
      });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      // Setup with matching target should inherit defaults
      expect(() => {
        const result = group.createFetchResponse(mockReq, { target: 'swr' });
        expect(result).toBeDefined();
      }).not.toThrow();
      
      expect(() => {
        // @ts-expect-error - Mismatched target ignores defaults
        group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      }).toThrow();
    });

    it('should not allow setup to override group target via defaults', () => {
      const group = new SSEChannelGroup<SWRSignal>({ 
        target: 'swr',
        channelDefaults: {
          target: 'swr'
        }
      });
      
      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');
      
      expect(() => {
        // @ts-expect-error - Cannot override group target constraint
        group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      }).toThrow();
    });

    it('should validate setup target when group target is set via channelDefaults only', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        channelDefaults: {
          target: 'swr'
        }
      });

      const mockReq = new Request('http://localhost/sse?__restale_cid__=conn-1');

      expect(() => {
        // @ts-expect-error - Incompatible target with channelDefaults.target
        group.createFetchResponse(mockReq, { target: 'tanstack-query' });
      }).toThrow(/not compatible with channel group targets/i);

      expect(() => {
        const result = group.createFetchResponse(mockReq, { target: 'swr' });
        expect(result.channel).toBeDefined();
      }).not.toThrow();
    });
  });
});
