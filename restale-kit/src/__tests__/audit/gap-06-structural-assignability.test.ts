/**
 * Gap 6: SSEChannel, EventStore, and PubSubAdapter are structurally assignable
 * across incompatible signal types
 * 
 * Their mutating APIs are interface methods, whose parameter positions are
 * bivariant. This can let a SSEChannel<TanStackQuerySignal> or 
 * EventStore<TanStackQuerySignal> enter an SWR group/channel configuration
 * without a cast.
 */

import { describe, it, expect } from 'vitest';
import { createSSEChannel, type SSEChannel } from '../../server/core/channel.js';
import { SSEChannelGroup } from '../../server/core/channel-group.js';
import { createEventStore, type EventStore } from '../../server/core/event-store.js';
import type { 
  SWRSignal, 
  TanStackQuerySignal, 
  RTKQuerySignal,
  PubSubAdapter 
} from '../../types/protocol.js';

describe('Gap 6: Structural assignability across incompatible signal types', () => {
  describe('SSEChannel cross-type assignment', () => {
    it('should reject assigning TanStack channel to SWR variable', () => {
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });
      
      // @ts-expect-error - Incompatible signal types
      const swrChannel: SSEChannel<SWRSignal> = tanstackChannel;
    });

    it('should reject assigning SWR channel to TanStack variable', () => {
      const swrChannel = createSSEChannel({ target: 'swr' });
      
      // @ts-expect-error - Incompatible signal types
      const tanstackChannel: SSEChannel<TanStackQuerySignal> = swrChannel;
    });

    it('should reject assigning RTK channel to SWR variable', () => {
      const rtkChannel = createSSEChannel({ target: 'rtk-query' });
      
      // @ts-expect-error - Incompatible signal types
      const swrChannel: SSEChannel<SWRSignal> = rtkChannel;
    });

    it('should reject cross-type channel in function parameter', () => {
      function processSWRChannel(channel: SSEChannel<SWRSignal>) {
        channel.invalidate({ target: 'swr', key: ['test'] });
      }
      
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });
      
      expect(() => {
        // @ts-expect-error - Type mismatch
        processSWRChannel(tanstackChannel);
      }).toThrow();
    });

    it('should reject cross-type channel in function return', () => {
      function getTanStackChannel(): SSEChannel<TanStackQuerySignal> {
        const swrChannel = createSSEChannel({ target: 'swr' });
        
        // @ts-expect-error - Cannot return SWR channel as TanStack
        return swrChannel;
      }
    });
  });

  describe('SSEChannelGroup registration type safety', () => {
    it('should reject registering TanStack channel in SWR group', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });

      // @ts-expect-error - Incompatible channel type
      group.register(tanstackChannel);
    });

    it('should reject registering SWR channel in TanStack group', () => {
      const group = new SSEChannelGroup<TanStackQuerySignal>({
        target: 'tanstack-query'
      });
      const swrChannel = createSSEChannel({ target: 'swr' });

      // @ts-expect-error - Incompatible channel type
      group.register(swrChannel);
    });

    it('should reject registering RTK channel in SWR group', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      const rtkChannel = createSSEChannel({ target: 'rtk-query' });

      // @ts-expect-error - Incompatible channel type
      group.register(rtkChannel);
    });

    it('should accept registering compatible channel', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      const swrChannel = createSSEChannel({ target: 'swr' });

      // Should compile
      group.register(swrChannel);
    });
  });

  describe('EventStore cross-type assignment', () => {
    it('should reject assigning TanStack store to SWR variable', () => {
      const tanstackStore = createEventStore<TanStackQuerySignal>({ capacity: 10 });

      // @ts-expect-error - Incompatible signal types
      const swrStore: EventStore<SWRSignal> = tanstackStore;
    });

    it('should reject assigning SWR store to RTK variable', () => {
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 });

      // @ts-expect-error - Incompatible signal types
      const rtkStore: EventStore<RTKQuerySignal> = swrStore;
    });

    it('should reject passing incompatible EventStore to channel', () => {
      const tanstackStore = createEventStore<TanStackQuerySignal>({ capacity: 10 });

      // @ts-expect-error - Store type must match channel type
      const swrChannel = createSSEChannel({
        target: 'swr',
        eventStore: tanstackStore
      });
    });

    it('should accept compatible EventStore', () => {
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 });

      const swrChannel = createSSEChannel({
        target: 'swr',
        eventStore: swrStore
      });
    });

    it('should reject incompatible store in function parameter', () => {
      function processSWRStore(store: EventStore<SWRSignal>) {
        // Process store
      }

      const tanstackStore = createEventStore<TanStackQuerySignal>({ capacity: 10 });

      // @ts-expect-error - Type mismatch
      processSWRStore(tanstackStore);
    });
  });

  describe('PubSubAdapter cross-type assignment', () => {
    it('should reject assigning TanStack adapter to SWR variable', () => {
      const tanstackAdapter: PubSubAdapter<TanStackQuerySignal> = {
        type: 'memory',
        publish: async () => {},
        subscribe: () => ({ unsubscribe: async () => {} })
      };
      
      // @ts-expect-error - Incompatible signal types
      const swrAdapter: PubSubAdapter<SWRSignal> = tanstackAdapter;
    });

    it('should reject passing incompatible adapter to group', () => {
      const rtkAdapter: PubSubAdapter<RTKQuerySignal> = {
        type: 'custom',
        publish: async () => {},
        subscribe: () => ({ unsubscribe: async () => {} })
      };
      
      // @ts-expect-error - Adapter type must match group type
      const swrGroup = new SSEChannelGroup<SWRSignal>({
        target: 'swr',
        pubsub: rtkAdapter
      });
    });

    it('should accept compatible adapter', () => {
      const swrAdapter: PubSubAdapter<SWRSignal> = {
        type: 'custom',
        publish: async () => {},
        subscribe: () => ({ unsubscribe: async () => {} })
      };
      
      const swrGroup = new SSEChannelGroup<SWRSignal>({
        target: 'swr',
        pubsub: swrAdapter
      });
    });
  });

  describe('Assignment-level tests (not just method calls)', () => {
    it('should fail at variable assignment, not method invocation', () => {
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });
      
      // Type error should occur at assignment
      // @ts-expect-error
      const swrChannel: SSEChannel<SWRSignal> = tanstackChannel;
      
      // Not just when calling methods
      // (If bivariance allows assignment, this would be the first failure point)
    });

    it('should fail when storing in typed array', () => {
      const channels: SSEChannel<SWRSignal>[] = [];
      
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });
      
      // @ts-expect-error - Cannot add incompatible channel to typed array
      channels.push(tanstackChannel);
    });

    it('should fail when storing in typed Map', () => {
      const channelMap = new Map<string, SSEChannel<SWRSignal>>();
      
      const rtkChannel = createSSEChannel({ target: 'rtk-query' });
      
      // @ts-expect-error - Cannot add incompatible channel to typed Map
      channelMap.set('test', rtkChannel);
    });

    it('should fail in object literal', () => {
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });
      
      const config: { channel: SSEChannel<SWRSignal> } = {
        // @ts-expect-error - Object expects SWR channel
        channel: tanstackChannel
      };
    });
  });

  describe('Generic function parameter contravariance', () => {
    it('should enforce contravariance in channel consumer', () => {
      type ChannelConsumer<T> = (channel: SSEChannel<T>) => void;
      
      const swrConsumer: ChannelConsumer<SWRSignal> = (channel) => {
        channel.invalidate({ target: 'swr', key: ['test'] });
      };
      
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });
      
      expect(() => {
        // @ts-expect-error - Cannot pass TanStack channel to SWR consumer
        swrConsumer(tanstackChannel);
      }).toThrow();
    });

    it('should enforce contravariance in store consumer', () => {
      type StoreConsumer<T> = (store: EventStore<T>) => void;
      
      const swrStoreConsumer: StoreConsumer<SWRSignal> = (store) => {
        // Process SWR store
      };
      
      const tanstackStore = createEventStore<TanStackQuerySignal>({ capacity: 10 });
      
      // @ts-expect-error - Cannot pass TanStack store to SWR consumer
      swrStoreConsumer(tanstackStore);
    });
  });

  describe('Callback and handler type safety', () => {
    it('should reject incompatible beforeFrame handler', () => {
      const tanstackChannel = createSSEChannel({
        target: 'tanstack-query',
        beforeFrame: (ctx) => {
          // Handler typed for TanStack signals
          return { action: 'send' as const };
        }
      });

      // @ts-expect-error - Cannot assign to SWR channel variable
      const swrChannel: SSEChannel<SWRSignal> = tanstackChannel;
    });

    it('should reject incompatible channel type via variable assignment', () => {
      const swrChannel = createSSEChannel({ target: 'swr' });

      // @ts-expect-error - Cannot assign to TanStack channel variable
      const tanstackChannel: SSEChannel<TanStackQuerySignal> = swrChannel;
    });
  });

  describe('Union types should not allow arbitrary assignment', () => {
    it('should reject assigning specific type to incompatible union', () => {
      const swrChannel = createSSEChannel({ target: 'swr' });
      
      // @ts-expect-error - SWR not in TanStack | RTK union
      const channel: SSEChannel<TanStackQuerySignal | RTKQuerySignal> = swrChannel;
    });

    it('should accept assigning specific type to compatible union', () => {
      const swrChannel = createSSEChannel({ target: 'swr' });
      
      // Should compile - SWR is in the union
      const channel: SSEChannel<SWRSignal | TanStackQuerySignal> = swrChannel;
    });

    it('should reject widening then narrowing incorrectly', () => {
      const swrChannel = createSSEChannel({ target: 'swr' });
      
      const wideChannel: SSEChannel<SWRSignal | RTKQuerySignal> = swrChannel;
      
      // @ts-expect-error - Cannot narrow union to incompatible type
      const narrowChannel: SSEChannel<RTKQuerySignal> = wideChannel;
    });
  });

  describe('Method signature preservation', () => {
    it('should maintain type safety through method reference', () => {
      const swrChannel = createSSEChannel({ target: 'swr' });
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });
      
      // Extract invalidate method
      const swrInvalidate = swrChannel.invalidate.bind(swrChannel);
      const tanstackInvalidate = tanstackChannel.invalidate.bind(tanstackChannel);
      
      // @ts-expect-error - Methods are not interchangeable
      const wrongBind: typeof swrInvalidate = tanstackInvalidate;
    });
  });

  describe('Integration with channel groups', () => {
    it('should prevent adding incompatible channel via register', () => {
      const group = new SSEChannelGroup<SWRSignal>({ target: 'swr' });
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });

      // @ts-expect-error - Type mismatch
      group.register(tanstackChannel);
    });

    it('should prevent incompatible channel type at assignment', () => {
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });

      // @ts-expect-error - Group expects SWR channels
      const swrChannel: SSEChannel<SWRSignal> = tanstackChannel;
    });
  });

  describe('Real-world scenario: mixed channel handling', () => {
    it('should prevent channel type confusion in routing logic', () => {
      function routeToChannel(
        type: 'swr' | 'tanstack',
        swrChannel: SSEChannel<SWRSignal>,
        tanstackChannel: SSEChannel<TanStackQuerySignal>
      ): SSEChannel<SWRSignal> {
        if (type === 'swr') {
          return swrChannel;
        }
        
        // @ts-expect-error - Cannot return TanStack channel as SWR
        return tanstackChannel;
      }
    });

    it('should maintain type safety in channel registry', () => {
      class ChannelRegistry<T extends SWRSignal | TanStackQuerySignal | RTKQuerySignal> {
        private channels = new Map<string, SSEChannel<T>>();
        
        register(id: string, channel: SSEChannel<T>) {
          this.channels.set(id, channel);
        }
        
        get(id: string): SSEChannel<T> | undefined {
          return this.channels.get(id);
        }
      }
      
      const swrRegistry = new ChannelRegistry<SWRSignal>();
      const tanstackChannel = createSSEChannel({ target: 'tanstack-query' });
      
      // @ts-expect-error - Cannot register TanStack channel in SWR registry
      swrRegistry.register('test', tanstackChannel);
    });
  });
});
