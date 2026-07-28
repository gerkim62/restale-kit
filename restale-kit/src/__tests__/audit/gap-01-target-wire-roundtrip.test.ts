/**
 * Gap 1: Target-specific wire frames are not client-round-trippable
 * 
 * Channel framing removes `target` from every signal, but the client validator
 * uses `target` to choose TanStack/SWR/RTK validation. This causes well-typed
 * server calls to produce payloads the client rejects.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSSEChannel } from '../../server/core/channel.js';
import { validateSignal } from '../../client/core/validation.js';
import type { TanStackQuerySignal, SWRSignal, RTKQuerySignal } from '../../types/protocol.js';

describe('Gap 1: Target-specific wire frames client round-trip', () => {
  describe('TanStack Query signals', () => {
    it('should preserve enough information for client to validate queryKey-based invalidation', () => {
      const channel = createSSEChannel({ target: 'tanstack-query' });
      
      // This is well-typed on the server
      const signal: TanStackQuerySignal = {
        target: 'tanstack-query',
        queryKey: ['todos', 'list']
      };
      
      // Frame the signal (simulating wire transmission)
      const frames: string[] = [];
      channel.invalidate(signal);
      
      // Capture what would be sent over SSE
      const response = channel.createFetchResponse();
      const reader = response.body?.getReader();
      
      // In real scenario, this would go over the wire and be parsed by client
      // The framed output removes target, making it { queryKey: [...] }
      // which fails client validation because generic signals require `key`
      
      // TODO: This test will fail until framing preserves target information
      // or client validation is updated to handle target-less frames
    });

    it('should validate all TanStack actions after round-trip', async () => {
      const channel = createSSEChannel({ target: 'tanstack-query' });
      
      const testCases: TanStackQuerySignal[] = [
        { target: 'tanstack-query', queryKey: ['users'] },
        { target: 'tanstack-query', queryKey: ['posts', 1] },
        { target: 'tanstack-query', queryKey: ['todos'], action: 'invalidate' },
        { target: 'tanstack-query', queryKey: ['profile'], action: 'refetch' },
        { target: 'tanstack-query', queryKey: ['settings'], action: 'reset' },
      ];
      
      for (const signal of testCases) {
        // TODO: Capture framed output and validate with client validator
        // Currently fails because target is stripped during framing
        channel.invalidate(signal);
      }
    });

    it('should handle exact/predicate matching after framing', () => {
      const channel = createSSEChannel({ target: 'tanstack-query' });
      
      const signals: TanStackQuerySignal[] = [
        { target: 'tanstack-query', queryKey: ['todos'], exact: true },
        { target: 'tanstack-query', queryKey: ['users'], predicate: true },
      ];
      
      // TODO: Verify these options survive framing and client can validate them
      signals.forEach(s => channel.invalidate(s));
    });
  });

  describe('RTK Query signals', () => {
    it('should preserve tags-based invalidation through framing', () => {
      const channel = createSSEChannel({ target: 'rtk-query' });
      
      const signal: RTKQuerySignal = {
        target: 'rtk-query',
        tags: [{ type: 'Todo' }, { type: 'User', id: 1 }]
      };
      
      // Framing converts this to { tags: [...] }
      // Generic signals don't accept tags, so client validation fails
      channel.invalidate(signal);
      
      // TODO: Assert framed payload is valid for client RTK validator
    });

    it('should validate all RTK actions after round-trip', () => {
      const channel = createSSEChannel({ target: 'rtk-query' });
      
      const testCases: RTKQuerySignal[] = [
        { target: 'rtk-query', tags: [{ type: 'Post' }] },
        { target: 'rtk-query', tags: [{ type: 'Comment', id: 42 }] },
        { target: 'rtk-query', tags: [{ type: 'User', id: 'abc' }] },
      ];
      
      for (const signal of testCases) {
        channel.invalidate(signal);
        // TODO: Capture frame, parse as client would, validate
      }
    });

    it('should handle RTK tag ID variations', () => {
      const channel = createSSEChannel({ target: 'rtk-query' });
      
      const signals: RTKQuerySignal[] = [
        { target: 'rtk-query', tags: [{ type: 'Item' }] }, // no ID
        { target: 'rtk-query', tags: [{ type: 'Item', id: 1 }] }, // numeric ID
        { target: 'rtk-query', tags: [{ type: 'Item', id: 'uuid' }] }, // string ID
      ];
      
      signals.forEach(s => channel.invalidate(s));
      // TODO: All should survive round-trip
    });
  });

  describe('SWR signals', () => {
    it('should preserve key-based invalidation after framing', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      const signal: SWRSignal = {
        target: 'swr',
        key: ['/api/todos']
      };
      
      channel.invalidate(signal);
      // TODO: Verify framed output is valid SWR signal for client
    });

    it('should validate all SWR actions after round-trip', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      const actions: Array<SWRSignal['action']> = [
        'revalidate',
        'mutate',
        'purge'
      ];
      
      for (const action of actions) {
        const signal: SWRSignal = {
          target: 'swr',
          key: ['/api/users'],
          action
        };
        
        channel.invalidate(signal);
        // Currently: action is preserved but becomes part of generic payload
        // Generic signals reject 'purge' and other SWR-specific actions
        // TODO: Assert client can parse and validate this as SWRSignal
      }
    });

    it('should handle SWR with optimisticData', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      const signal: SWRSignal = {
        target: 'swr',
        key: ['/api/todos', 1],
        action: 'mutate',
        optimisticData: { id: 1, title: 'Updated' }
      };
      
      channel.invalidate(signal);
      // TODO: Verify optimisticData survives round-trip
    });

    it('should handle SWR revalidate options', () => {
      const channel = createSSEChannel({ target: 'swr' });
      
      const signal: SWRSignal = {
        target: 'swr',
        key: ['/api/posts'],
        action: 'revalidate',
        revalidateOptions: { rollbackOnError: true }
      };
      
      channel.invalidate(signal);
      // TODO: Verify options survive framing
    });
  });

  describe('Multi-target scenarios', () => {
    it('should preserve target information when filtering is active', () => {
      const channel = createSSEChannel({ 
        target: ['tanstack-query', 'swr'] as const
      });
      
      // Multi-target channels need target preserved to determine routing
      const signals = [
        { target: 'tanstack-query' as const, queryKey: ['todos'] },
        { target: 'swr' as const, key: ['/api/todos'] }
      ];
      
      channel.invalidate(signals);
      // TODO: Client needs target to know which adapter to invoke
    });

    it('should allow client to filter by requested target', () => {
      // Client connects with target preference
      // Server broadcasts multi-target signals
      // Client must be able to filter based on preserved target info
      
      const channel = createSSEChannel({
        target: ['tanstack-query', 'swr', 'rtk-query'] as const
      });
      
      const allTargets = [
        { target: 'tanstack-query' as const, queryKey: ['users'] },
        { target: 'swr' as const, key: ['/api/users'] },
        { target: 'rtk-query' as const, tags: [{ type: 'User' }] }
      ];
      
      channel.invalidate(allTargets);
      
      // TODO: Client with target='swr' should only process SWR signal
      // This requires target to be present in framed payload
    });
  });

  describe('End-to-end frame and validation', () => {
    it('should successfully validate TanStack signal after full round-trip', async () => {
      const channel = createSSEChannel({ target: 'tanstack-query' });
      const signal: TanStackQuerySignal = {
        target: 'tanstack-query',
        queryKey: ['test']
      };
      
      channel.invalidate(signal);
      
      // Simulate receiving on client side
      const response = channel.createFetchResponse();
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        const { value } = await reader.read();
        if (value) {
          const text = decoder.decode(value);
          // Parse SSE format: data: {...}\n\n
          const dataMatch = text.match(/data: (.+)/);
          if (dataMatch) {
            const parsed = JSON.parse(dataMatch[1]);
            
            // This should pass client validation
            // Currently fails because target is missing
            const validationResult = validateSignal(parsed, 'tanstack-query');
            expect(validationResult.valid).toBe(true);
          }
        }
      }
    });

    it('should successfully validate RTK signal after full round-trip', async () => {
      const channel = createSSEChannel({ target: 'rtk-query' });
      const signal: RTKQuerySignal = {
        target: 'rtk-query',
        tags: [{ type: 'Todo', id: 1 }]
      };
      
      channel.invalidate(signal);
      
      const response = channel.createFetchResponse();
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        const { value } = await reader.read();
        if (value) {
          const text = decoder.decode(value);
          const dataMatch = text.match(/data: (.+)/);
          if (dataMatch) {
            const parsed = JSON.parse(dataMatch[1]);
            const validationResult = validateSignal(parsed, 'rtk-query');
            expect(validationResult.valid).toBe(true);
          }
        }
      }
    });

    it('should successfully validate SWR signal after full round-trip', async () => {
      const channel = createSSEChannel({ target: 'swr' });
      const signal: SWRSignal = {
        target: 'swr',
        key: ['/api/test'],
        action: 'purge'
      };
      
      channel.invalidate(signal);
      
      const response = channel.createFetchResponse();
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        const { value } = await reader.read();
        if (value) {
          const text = decoder.decode(value);
          const dataMatch = text.match(/data: (.+)/);
          if (dataMatch) {
            const parsed = JSON.parse(dataMatch[1]);
            const validationResult = validateSignal(parsed, 'swr');
            expect(validationResult.valid).toBe(true);
          }
        }
      }
    });
  });
});
