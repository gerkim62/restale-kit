/**
 * Gap 6: SSEChannel, EventStore, and PubSubAdapter are structurally assignable
 * across incompatible signal types
 * 
 * Their mutating APIs are interface methods, whose parameter positions are bivariant.
 * This can let a SSEChannel<TanStackQuerySignal> or EventStore<TanStackQuerySignal>
 * enter an SWR group/channel configuration without a cast.
 */

import { describe, expectTypeOf, test } from 'vitest'
import { createSSEChannel, type SSEChannel } from '@/server/core/index.js'
import { createEventStore, type EventStore } from '@/server/core/index.js'
import { SSEChannelGroup } from '@/server/core/index.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal, InvalidateSignal } from '@/types/index.js'

describe('Gap 6: Structural assignability across incompatible signal types', () => {
  describe('SSEChannel assignment validation', () => {
    test('should reject assigning TanStack channel to SWR channel variable', () => {
      const tanstackChannel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      
      // @ts-expect-error - Cannot assign TanStack channel to SWR channel type
      const swrChannel: SSEChannel<SWRSignal> = tanstackChannel
    })

    test('should reject assigning SWR channel to TanStack channel variable', () => {
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      // @ts-expect-error - Cannot assign SWR channel to TanStack channel type
      const tanstackChannel: SSEChannel<TanStackQuerySignal> = swrChannel
    })

    test('should reject assigning RTK channel to SWR channel variable', () => {
      const rtkChannel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      // @ts-expect-error - Cannot assign RTK channel to SWR channel type
      const swrChannel: SSEChannel<SWRSignal> = rtkChannel
    })

    test('should reject assigning specific channel to wider signal union', () => {
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })

      // @ts-expect-error - SSEChannel is contravariant in TSignal (parameter position in invalidate)
      const genericChannel: SSEChannel<InvalidateSignal> = swrChannel
    })

    test('should reject assigning specific channel to mixed union type', () => {
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })

      // @ts-expect-error - SSEChannel is contravariant in TSignal
      const mixedChannel: SSEChannel<SWRSignal | TanStackQuerySignal> = swrChannel
    })
  })

  describe('SSEChannel method call validation', () => {
    test('should reject incompatible signal in invalidate method', () => {
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      // @ts-expect-error - TanStack signal incompatible with SWR channel
      swrChannel.invalidate({ target: 'tanstack-query', queryKey: ['test'] })
      
      // @ts-expect-error - RTK signal incompatible with SWR channel
      swrChannel.invalidate({ target: 'rtk-query', tags: [{ type: 'Test' }] })
    })

    test('should accept compatible signal in invalidate method', () => {
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      swrChannel.invalidate({ target: 'swr', key: ['test'] })
      expectTypeOf(swrChannel).not.toEqualTypeOf<never>()
    })

    test('should reject passing incompatible channel to function expecting specific type', () => {
      function processSWRChannel(channel: SSEChannel<SWRSignal>) {
        channel.invalidate({ target: 'swr', key: ['test'] })
      }
      
      const tanstackChannel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      
      // @ts-expect-error - TanStack channel incompatible with SWR function parameter
      processSWRChannel(tanstackChannel)
    })
  })

  describe('EventStore assignment validation', () => {
    test('should reject assigning TanStack store to SWR store variable', () => {
      const tanstackStore = createEventStore<TanStackQuerySignal>({ capacity: 10 })
      
      // @ts-expect-error - Cannot assign TanStack store to SWR store type
      const swrStore: EventStore<SWRSignal> = tanstackStore
    })

    test('should reject assigning SWR store to TanStack store variable', () => {
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 })
      
      // @ts-expect-error - Cannot assign SWR store to TanStack store type
      const tanstackStore: EventStore<TanStackQuerySignal> = swrStore
    })

    test('should reject assigning RTK store to SWR store variable', () => {
      const rtkStore = createEventStore<RTKQuerySignal>({ capacity: 10 })
      
      // @ts-expect-error - Cannot assign RTK store to SWR store type
      const swrStore: EventStore<SWRSignal> = rtkStore
    })

    test('should allow assigning to compatible signal union', () => {
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 })
      
      // Stores consume signals, so widening their accepted signal type is unsafe.
      // @ts-expect-error - A store for only SWR signals cannot accept every protocol signal
      const genericStore: EventStore<InvalidateSignal> = swrStore
    })
  })

  describe('EventStore method call validation', () => {
    test('should reject incompatible signal in add method', () => {
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 })
      
      // @ts-expect-error - TanStack signal incompatible with SWR store
      swrStore.add({ target: 'tanstack-query', queryKey: ['test'] })
      
      // @ts-expect-error - RTK signal incompatible with SWR store
      swrStore.add({ target: 'rtk-query', tags: [{ type: 'Test' }] })
    })

    test('should accept compatible signal in add method', () => {
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 })
      
      const record = swrStore.add({ target: 'swr', key: ['test'] })
      expectTypeOf(record).not.toEqualTypeOf<never>()
    })

    test('should reject passing incompatible store to function', () => {
      function processSWRStore(store: EventStore<SWRSignal>) {
        store.add({ target: 'swr', key: ['test'] })
      }
      
      const tanstackStore = createEventStore<TanStackQuerySignal>({ capacity: 10 })
      
      // @ts-expect-error - TanStack store incompatible with SWR function parameter
      processSWRStore(tanstackStore)
    })
  })

  describe('PubSubAdapter assignment validation', () => {
    test('should reject assigning TanStack adapter to SWR adapter variable', () => {
      const tanstackAdapter: PubSubAdapter<TanStackQuerySignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      // @ts-expect-error - Cannot assign TanStack adapter to SWR adapter type
      const swrAdapter: PubSubAdapter<SWRSignal> = tanstackAdapter
    })

    test('should reject assigning SWR adapter to TanStack adapter variable', () => {
      const swrAdapter: PubSubAdapter<SWRSignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      // @ts-expect-error - Cannot assign SWR adapter to TanStack adapter type
      const tanstackAdapter: PubSubAdapter<TanStackQuerySignal> = swrAdapter
    })

    test('should reject assigning RTK adapter to SWR adapter variable', () => {
      const rtkAdapter: PubSubAdapter<RTKQuerySignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      // @ts-expect-error - Cannot assign RTK adapter to SWR adapter type
      const swrAdapter: PubSubAdapter<SWRSignal> = rtkAdapter
    })

    test('should allow assigning to compatible signal union', () => {
      const swrAdapter: PubSubAdapter<SWRSignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      // Adapters consume published signal envelopes, so widening is unsafe.
      // @ts-expect-error - An SWR adapter cannot publish every protocol signal
      const genericAdapter: PubSubAdapter<InvalidateSignal> = swrAdapter
    })
  })

  describe('PubSubAdapter method call validation', () => {
    test('should reject incompatible signal in publish method', () => {
      const swrAdapter: PubSubAdapter<SWRSignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      // @ts-expect-error - TanStack signal incompatible with SWR adapter
      void swrAdapter.publish('topic', {
        kind: 'signal' as const,
        data: { target: 'tanstack-query' as const, queryKey: ['test'] }
      })
    })

    test('should accept compatible signal in publish method', () => {
      const swrAdapter: PubSubAdapter<SWRSignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      void swrAdapter.publish('topic', {
        kind: 'signal' as const,
        data: { target: 'swr' as const, key: ['test'] }
      })
      expectTypeOf(swrAdapter).not.toEqualTypeOf<never>()
    })

    test('should reject passing incompatible adapter to function', () => {
      function processSWRAdapter(adapter: PubSubAdapter<SWRSignal>) {
        void adapter.publish('topic', {
          kind: 'signal' as const,
          data: { target: 'swr' as const, key: ['test'] }
        })
      }
      
      const tanstackAdapter: PubSubAdapter<TanStackQuerySignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      // @ts-expect-error - TanStack adapter incompatible with SWR function parameter
      processSWRAdapter(tanstackAdapter)
    })
  })

  describe('SSEChannelGroup registration with incompatible types', () => {
    test('should reject registering TanStack channel to SWR group', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      const tanstackChannel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      
      // @ts-expect-error - Cannot register TanStack channel to SWR group
      swrGroup.register(tanstackChannel)
    })

    test('should reject registering SWR channel to TanStack group', () => {
      const tanstackGroup = new SSEChannelGroup<TanStackQuerySignal>()
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      // @ts-expect-error - Cannot register SWR channel to TanStack group
      tanstackGroup.register(swrChannel)
    })

    test('should reject registering RTK channel to SWR group', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      const rtkChannel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      // @ts-expect-error - Cannot register RTK channel to SWR group
      swrGroup.register(rtkChannel)
    })

    test('should accept registering channel with matching signal type', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      swrGroup.register(swrChannel)
      expectTypeOf(swrGroup.size).toEqualTypeOf<number>()
    })
  })

  describe('SSEChannelGroup with incompatible EventStore', () => {
    test('should reject TanStack store in SWR group options', () => {
      const tanstackStore = createEventStore<TanStackQuerySignal>({ capacity: 10 })
      
      new SSEChannelGroup<SWRSignal>({
        // @ts-expect-error - TanStack store is incompatible with an SWR group
        eventStore: tanstackStore
      })
    })

    test('should reject SWR store in TanStack group options', () => {
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 })
      
      new SSEChannelGroup<TanStackQuerySignal>({
        // @ts-expect-error - SWR store is incompatible with a TanStack group
        eventStore: swrStore
      })
    })

    test('should reject RTK store in SWR group options', () => {
      const rtkStore = createEventStore<RTKQuerySignal>({ capacity: 10 })
      
      new SSEChannelGroup<SWRSignal>({
        // @ts-expect-error - RTK store is incompatible with an SWR group
        eventStore: rtkStore
      })
    })

    test('should accept matching store in group options', () => {
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 })
      
      const swrGroup = new SSEChannelGroup<SWRSignal>({
        eventStore: swrStore
      })
      
      expectTypeOf(swrGroup.eventStore).toEqualTypeOf<EventStore<SWRSignal> | undefined>()
    })
  })

  describe('SSEChannelGroup with incompatible PubSubAdapter', () => {
    test('should reject TanStack adapter in SWR group options', () => {
      const tanstackAdapter: PubSubAdapter<TanStackQuerySignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      new SSEChannelGroup<SWRSignal>({
        // @ts-expect-error - TanStack adapter is incompatible with an SWR group
        pubsub: tanstackAdapter
      })
    })

    test('should reject SWR adapter in TanStack group options', () => {
      const swrAdapter: PubSubAdapter<SWRSignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      new SSEChannelGroup<TanStackQuerySignal>({
        // @ts-expect-error - SWR adapter is incompatible with a TanStack group
        pubsub: swrAdapter
      })
    })

    test('should reject RTK adapter in SWR group options', () => {
      const rtkAdapter: PubSubAdapter<RTKQuerySignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      new SSEChannelGroup<SWRSignal>({
        // @ts-expect-error - RTK adapter is incompatible with an SWR group
        pubsub: rtkAdapter
      })
    })

    test('should accept matching adapter in group options', () => {
      const swrAdapter: PubSubAdapter<SWRSignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      const swrGroup = new SSEChannelGroup<SWRSignal>({
        pubsub: swrAdapter
      })
      
      expectTypeOf(swrGroup).not.toEqualTypeOf<never>()
    })
  })

  describe('Complex scenarios with multiple incompatibilities', () => {
    test('should reject group with all mismatched types', () => {
      const tanstackChannel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      const tanstackStore = createEventStore<TanStackQuerySignal>({ capacity: 10 })
      const tanstackAdapter: PubSubAdapter<TanStackQuerySignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      const swrGroup = new SSEChannelGroup<SWRSignal>({
        // @ts-expect-error - TanStack store incompatible
        eventStore: tanstackStore,
        // @ts-expect-error - TanStack adapter incompatible
        pubsub: tanstackAdapter
      })
      
      // @ts-expect-error - TanStack channel incompatible
      swrGroup.register(tanstackChannel)
    })

    test('should accept group with all matching types', () => {
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 })
      const swrAdapter: PubSubAdapter<SWRSignal> = {
        publish: async () => {},
        subscribe: () => Promise.resolve(() => {})
      }
      
      const swrGroup = new SSEChannelGroup<SWRSignal>({
        eventStore: swrStore,
        pubsub: swrAdapter
      })
      
      swrGroup.register(swrChannel)
      expectTypeOf(swrGroup).not.toEqualTypeOf<never>()
    })
  })

  describe('Array and batch operations', () => {
    test('should reject array with mixed incompatible channel types', () => {
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })
      const tanstackChannel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      
      // @ts-expect-error - Array cannot contain incompatible types
      const channels: SSEChannel<SWRSignal>[] = [swrChannel, tanstackChannel]
    })

    test('should reject array with mixed incompatible store types', () => {
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 })
      const tanstackStore = createEventStore<TanStackQuerySignal>({ capacity: 10 })
      
      // @ts-expect-error - Array cannot contain incompatible types
      const stores: EventStore<SWRSignal>[] = [swrStore, tanstackStore]
    })

    test('should accept homogeneous arrays', () => {
      const swrChannel1 = createSSEChannel<SWRSignal>({ target: 'swr' })
      const swrChannel2 = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      const channels: SSEChannel<SWRSignal>[] = [swrChannel1, swrChannel2]
      expectTypeOf(channels).not.toEqualTypeOf<never>()
    })
  })

  describe('Generic function type safety', () => {
    test('should maintain type safety in generic functions', () => {
      function broadcastToChannel<T extends InvalidateSignal>(
        channel: SSEChannel<T>,
        signal: T
      ) {
        channel.invalidate(signal)
      }
      
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      broadcastToChannel(swrChannel, { target: 'swr', key: ['test'] })
      
      // @ts-expect-error - TanStack signal incompatible with SWR channel
      broadcastToChannel(swrChannel, { target: 'tanstack-query', queryKey: ['test'] })
    })

    test('should maintain type safety with EventStore in generic functions', () => {
      function addToStore<T extends InvalidateSignal>(
        store: EventStore<T>,
        signal: T
      ) {
        return store.add(signal)
      }
      
      const swrStore = createEventStore<SWRSignal>({ capacity: 10 })
      
      addToStore(swrStore, { target: 'swr', key: ['test'] })
      
      // @ts-expect-error - TanStack signal incompatible with SWR store
      addToStore(swrStore, { target: 'tanstack-query', queryKey: ['test'] })
    })
  })
})
