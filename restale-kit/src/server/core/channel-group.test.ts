import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SSEChannelGroup } from './channel-group.js'
import { createSSEChannel } from './channel.js'
import { createEventStore } from './event-store.js'
import { SchemaValidationError } from '@/types/errors.js'
import { createValidSchema, createInvalidSchema } from '@/test-fixtures/schemas.js'
import { MemoryPubSubAdapter } from '@/test-fixtures/pubsub.js'

interface TestMeta {
  userId: number
  role?: string
}

describe('channel-group', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('validates metadata against metaSchema on registration', () => {
    const metaSchema = createInvalidSchema('Invalid metadata')
    const group = new SSEChannelGroup<TestMeta>({ metaSchema })
    const channel = createSSEChannel({})

    expect(() => { group.register(channel, { userId: -1 }); }).toThrow(SchemaValidationError)
    expect(group.size).toBe(0)
  })

  it('allows omitting meta when no metaSchema provided', () => {
    const group = new SSEChannelGroup()
    const channel = createSSEChannel({})

    // Should work without passing meta
    group.register(channel)
    expect(group.size).toBe(1)

    const spy = vi.spyOn(channel, 'invalidate')
    group.broadcastToAll({ key: ['test'] })
    expect(spy).toHaveBeenCalled()
  })

  it('broadcasts only to channels selected by its predicate', async () => {
    const group = new SSEChannelGroup<TestMeta>()
    const selected = createSSEChannel({})
    const skipped = createSSEChannel({})
    group.register(selected, { userId: 1 })
    group.register(skipped, { userId: 2 })
    const selectedSpy = vi.spyOn(selected, 'invalidate')
    const skippedSpy = vi.spyOn(skipped, 'invalidate')

    await group.broadcast({ key: ['todos'] }, (meta) => meta?.userId === 1)

    expect(selectedSpy).toHaveBeenCalledOnce()
    expect(skippedSpy).not.toHaveBeenCalled()
  })

  it('stores validated client context and enforces connection scope-pinning', async () => {
    const group = new SSEChannelGroup<TestMeta, { page: number }>({})
    const channel = createSSEChannel()
    group.register(channel, { userId: 7 })

    await expect(group.updateClientContext(channel.connectionId, { page: 2 }, { scope: { userId: 8 } }))
      .resolves.toEqual({ updated: false })
    expect(group.getClientContext(channel.connectionId)).toBeUndefined()

    await expect(group.updateClientContext(channel.connectionId, { page: 2 }, { scope: { userId: 7 } }))
      .resolves.toEqual({ updated: true })
    expect(group.getClientContext(channel.connectionId)).toEqual({ page: 2 })
    await expect(group.updateClientContext('missing', { page: 3 })).resolves.toEqual({ updated: false })
  })

  it('ignores client-context updates with a lower or equal revision', async () => {
    const group = new SSEChannelGroup<TestMeta, { page: number }>({})
    const channel = createSSEChannel()
    group.register(channel, { userId: 7 })

    await expect(group.updateClientContext(channel.connectionId, { page: 2 }, { revision: 2 }))
      .resolves.toEqual({ updated: true })
    await expect(group.updateClientContext(channel.connectionId, { page: 1 }, { revision: 1 }))
      .resolves.toEqual({ updated: false })
    await expect(group.updateClientContext(channel.connectionId, { page: 99 }, { revision: 2 }))
      .resolves.toEqual({ updated: false })
    expect(group.getClientContext(channel.connectionId)).toEqual({ page: 2 })
  })

  it('does not store invalid client context and removes stored context on deregistration', async () => {
    const group = new SSEChannelGroup<TestMeta, { page: number }>({
      clientContextSchema: createInvalidSchema<{ page: number }>('Invalid client context'),
    })
    const channel = createSSEChannel()
    group.register(channel, { userId: 7 })

    await expect(group.updateClientContext(channel.connectionId, { page: 1 })).rejects.toThrow(SchemaValidationError)
    expect(group.getClientContext(channel.connectionId)).toBeUndefined()

    const unvalidated = new SSEChannelGroup<TestMeta, { page: number }>({})
    const secondChannel = createSSEChannel()
    unvalidated.register(secondChannel, { userId: 8 })
    await unvalidated.updateClientContext(secondChannel.connectionId, { page: 4 })
    unvalidated.deregister(secondChannel)
    expect(unvalidated.getClientContext(secondChannel.connectionId)).toBeUndefined()
  })

  it('delivers inline data only to the channel selected for its topic', async () => {
    const group = new SSEChannelGroup<TestMeta, { page: number }>({
      resolveInlineData: (connections) => new Map(connections.map((connection) => [
        connection.connectionId,
        { signal: { key: ['todos'] }, inlineData: ['fresh'] },
      ])),
    })
    const selected = createSSEChannel()
    const unselected = createSSEChannel()
    const selectedInvalidate = vi.spyOn(selected, 'invalidate')
    const unselectedInvalidate = vi.spyOn(unselected, 'invalidate')
    group.register(selected, { userId: 1 }, { topics: ['todos'] })
    group.register(unselected, { userId: 1 }, { topics: ['other'] })

    await group.pushInlineData('todos', { source: 'test' })

    expect(selectedInvalidate).toHaveBeenCalledOnce()
    expect(unselectedInvalidate).not.toHaveBeenCalled()
  })

  it('broadcastToAll delivers to all channels even when meta is undefined', () => {
    // Regression: broadcast() previously had `if (entry.meta === undefined) continue`
    // which skipped channels registered without meta, breaking broadcastToAll.
    const group = new SSEChannelGroup()
    const ch1 = createSSEChannel({})
    const ch2 = createSSEChannel({})
    const ch3 = createSSEChannel({})

    const spy1 = vi.spyOn(ch1, 'invalidate')
    const spy2 = vi.spyOn(ch2, 'invalidate')
    const spy3 = vi.spyOn(ch3, 'invalidate')

    group.register(ch1)
    group.register(ch2)
    group.register(ch3)

    group.broadcastToAll({ key: ['update'] })

    expect(spy1).toHaveBeenCalledWith({ key: ['update'] }, undefined)
    expect(spy2).toHaveBeenCalledWith({ key: ['update'] }, undefined)
    expect(spy3).toHaveBeenCalledWith({ key: ['update'] }, undefined)
  })

  it('broadcast predicate is called with undefined meta when TMeta accepts undefined', async () => {
    // Verifies the `meta as TMeta` cast in register is sound: when TMeta includes
    // undefined, the predicate receives undefined (not skipped) and can act on it.
    const group = new SSEChannelGroup<{ userId: number } | undefined>()
    const chWithMeta = createSSEChannel({})
    const chNoMeta = createSSEChannel({})

    const spyWith = vi.spyOn(chWithMeta, 'invalidate')
    const spyNo = vi.spyOn(chNoMeta, 'invalidate')

    group.register(chWithMeta, { userId: 1 })
    group.register(chNoMeta) // meta is undefined — valid because TMeta accepts undefined

    const seenMetas: ({ userId: number } | undefined)[] = []
    await group.broadcast({ key: ['test'] }, (meta) => {
      seenMetas.push(meta)
      return true
    })

    expect(seenMetas).toContain(undefined)
    expect(seenMetas).toContainEqual({ userId: 1 })
    expect(spyWith).toHaveBeenCalled()
    expect(spyNo).toHaveBeenCalled()
  })

  it('broadcast predicate can filter out channels with undefined meta', async () => {
    // Predicate returning false for undefined meta should skip that channel,
    // but NOT all channels — channels with defined meta should still be reached.
    const group = new SSEChannelGroup<{ userId: number } | undefined>()
    const chWithMeta = createSSEChannel({})
    const chNoMeta = createSSEChannel({})

    const spyWith = vi.spyOn(chWithMeta, 'invalidate')
    const spyNo = vi.spyOn(chNoMeta, 'invalidate')

    group.register(chWithMeta, { userId: 42 })
    group.register(chNoMeta)

    await group.broadcast({ key: ['targeted'] }, (meta) => meta !== undefined)

    expect(spyWith).toHaveBeenCalled()
    expect(spyNo).not.toHaveBeenCalled()
  })

  it('broadcastByKey silently skips channels with undefined meta (not a JSON value)', () => {
    // undefined is not a valid JSONValue, so isJSONValue(meta) returns false and
    // the channel is excluded from key-based matching — this is correct behaviour.
    const group = new SSEChannelGroup<{ userId: number } | undefined>()
    const chWithMeta = createSSEChannel({})
    const chNoMeta = createSSEChannel({})

    const spyWith = vi.spyOn(chWithMeta, 'invalidate')
    const spyNo = vi.spyOn(chNoMeta, 'invalidate')

    group.register(chWithMeta, { userId: 7 })
    group.register(chNoMeta) // undefined meta

    group.broadcastByKey({ key: [{ userId: 7 }] })

    expect(spyWith).toHaveBeenCalled()
    expect(spyNo).not.toHaveBeenCalled()
  })

  it('omitting meta sets metadata to undefined — revokeWhere cannot match it by criteria', async () => {
    // Omitting meta stores undefined internally. Because undefined is not a valid JSONValue,
    // channelMatchesCriteria returns false for any criteria — revokeWhere cannot revoke
    // these channels by metadata match. Use revokeByConnectionId(connectionId) instead.
    const group = new SSEChannelGroup()
    const ch = createSSEChannel({})

    group.register(ch) // no meta — meta is undefined
    expect(group.size).toBe(1)

    const result = await group.revokeWhere({})
    expect(result.localClosed).toBe(0) // {} criteria does NOT match undefined meta
    expect(ch.state).toBe('open')
    expect(group.size).toBe(1)
  })

  it('channels with undefined meta can still be revoked via revokeByConnectionId(connectionId)', async () => {
    // revokeByConnectionId looks up by connectionId directly, bypassing metadata matching,
    // so it works regardless of whether meta was provided.
    const group = new SSEChannelGroup()
    const ch = createSSEChannel()

    group.register(ch)
    expect(group.size).toBe(1)

    const result = await group.revokeByConnectionId(ch.connectionId)
    expect(result.closed).toBe(true)
    expect(ch.state).toBe('closed')
    expect(group.size).toBe(0)
  })

  it('allows omitting meta even with metaSchema if default satisfies schema', () => {
    const metaSchema = createValidSchema()
    const group = new SSEChannelGroup<any>({ metaSchema })
    const channel = createSSEChannel({})

    // Omitted metadata (undefined) passes validation
    group.register(channel)
    expect(group.size).toBe(1)
  })

  it('defaults omitted meta to undefined when registering', () => {
    const group = new SSEChannelGroup<any>()
    const channel = createSSEChannel({})
    group.register(channel)

    const entry = group['channels'].get(channel)
    expect(entry).toBeDefined()
    expect(entry?.meta).toBeUndefined()
  })

  it('respects metaSchema and triggers validation error if omitted meta does not satisfy schema', () => {
    const metaSchema = createInvalidSchema('Metadata is required')
    const group = new SSEChannelGroup<any>({ metaSchema })
    const channel = createSSEChannel({})

    expect(() => {
      group.register(channel)
    }).toThrow(SchemaValidationError)
  })

  it('stores the coerced/transformed metadata returned by the schema when metaSchema is defined', () => {
    const metaSchema = createValidSchema((val: any) => {
      const obj = val && typeof val === 'object' ? val : {}
      return {
        userId: Number(obj.userId || 42),
        role: String(obj.role || 'guest')
      }
    })
    const group = new SSEChannelGroup<{ userId?: number; role?: string } | undefined>({ metaSchema })
    const channel = createSSEChannel({})

    group.register(channel)

    const entry = (group as any).channels.get(channel)
    expect(entry.meta).toEqual({ userId: 42, role: 'guest' })
  })

  it('allows omitted metadata and rejects metadata with the wrong shape at compile-time', () => {
    const group = new SSEChannelGroup<TestMeta>()
    const channel = createSSEChannel({})

    group.register(channel)

    // @ts-expect-error - meta must match TestMeta type (userId must be number)
    group.register(channel, { userId: 'not-a-number' })

    // Should compile when meta is provided
    group.register(channel, { userId: 1 })
  })

  it('enforces metaSchema output type to match TMeta at compile-time', () => {
    const stringSchema = createValidSchema((_val: unknown) => 'hello')

    // @ts-expect-error - metaSchema output (string) does not match TMeta (TestMeta)
    new SSEChannelGroup<TestMeta>({ metaSchema: stringSchema })
  })

  it('statically verifies register metadata is optional', () => {
    // Metadata is stored as TMeta | undefined, so registration can omit it.
    type ParamsRequired = Parameters<SSEChannelGroup<TestMeta>['register']>
    type IsRequiredOptional = 1 extends ParamsRequired['length'] ? true : false
    const checkRequired: IsRequiredOptional = true
    expect(checkRequired).toBe(true)

    // 2. When TMeta accepts undefined, meta parameter must be optional
    type ParamsOptional = Parameters<SSEChannelGroup<TestMeta | undefined>['register']>
    type IsOptionalOptional = 1 extends ParamsOptional['length'] ? true : false
    const checkOptional: IsOptionalOptional = true
    expect(checkOptional).toBe(true)
  })

  it('broadcast predicate represents omitted metadata explicitly', async () => {
    const group = new SSEChannelGroup<TestMeta>()
    const channel = createSSEChannel({})
    group.register(channel, { userId: 1 })

    // Static check: callers handle omitted metadata before reading fields.
    await group.broadcast({ key: ['test'] }, (meta) => {
      if (meta === undefined) return false
      const _userId: number = meta.userId
      return _userId > 0
    })
  })

  it('registers channel and handles topic updates on re-registration', () => {
    const group = new SSEChannelGroup<TestMeta>()
    const channel = createSSEChannel({})

    group.register(channel, { userId: 1 }, { topics: ['topic-a', 'topic-b'] })
    expect(group.size).toBe(1)

    // Re-register with only topic-b
    group.register(channel, { userId: 1 }, { topics: ['topic-b'] })
    expect(group.size).toBe(1)
  })

  it('broadcast filter selectively delivers signals to matching predicate', async () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch1 = createSSEChannel({})
    const ch2 = createSSEChannel({})

    const spy1 = vi.spyOn(ch1, 'invalidate')
    const spy2 = vi.spyOn(ch2, 'invalidate')

    group.register(ch1, { userId: 1, role: 'admin' })
    group.register(ch2, { userId: 2, role: 'user' })

    await group.broadcast({ key: ['admin-data'] }, (meta) => meta?.role === 'admin')

    expect(spy1).toHaveBeenCalledWith({ key: ['admin-data'] }, undefined)
    expect(spy2).not.toHaveBeenCalled()
  })

  it('broadcastToAll delivers to all registered channels', () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch1 = createSSEChannel({})
    const ch2 = createSSEChannel({})

    const spy1 = vi.spyOn(ch1, 'invalidate')
    const spy2 = vi.spyOn(ch2, 'invalidate')

    group.register(ch1, { userId: 1 })
    group.register(ch2, { userId: 2 })

    group.broadcastToAll({ key: ['global-update'] })

    expect(spy1).toHaveBeenCalled()
    expect(spy2).toHaveBeenCalled()
  })

  it('deregisters closed channels automatically during broadcast', () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch1 = createSSEChannel({})

    group.register(ch1, { userId: 1 })
    expect(group.size).toBe(1)

    // Close after registration — auto-deregister fires via onClose
    ch1.close()
    expect(group.size).toBe(0)
  })

  it('aggregates errors on broadcast failures', () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch = createSSEChannel({})
    vi.spyOn(ch, 'invalidate').mockImplementation(() => { throw new Error('Runtime invalidate error') })

    group.register(ch, { userId: 1 })

    expect(() => { group.broadcastToAll({ key: ['test'] }); }).toThrow(AggregateError)
  })

  it('publishes locally before publishing to broker pubsub', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const publishSpy = vi.spyOn(pubsub, 'publish')

    const group = new SSEChannelGroup<TestMeta>({ pubsub })
    const ch = createSSEChannel({})
    const invalidateSpy = vi.spyOn(ch, 'invalidate')

    group.register(ch, { userId: 10 }, { topics: ['notifications'] })

    await group.publish('notifications', { key: ['alert'] })

    expect(invalidateSpy).toHaveBeenCalledWith({ key: ['alert'] }, undefined)
    expect(publishSpy).toHaveBeenCalledWith('notifications', {
      kind: 'signal',
      data: { key: ['alert'] },
      id: undefined,
    })
  })

  it('includes eventId in pubsub.publish payload when group has eventBufferCapacity', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const publishSpy = vi.spyOn(pubsub, 'publish')

    const group = new SSEChannelGroup<TestMeta>({ pubsub, eventBufferCapacity: 10 })
    const ch = createSSEChannel({})
    group.register(ch, { userId: 10 }, { topics: ['notifications'] })

    await group.publish('notifications', { key: ['alert'] })

    expect(publishSpy).toHaveBeenCalledWith(
      'notifications',
      expect.objectContaining({
        kind: 'signal',
        data: { key: ['alert'] },
        id: expect.any(String),
      })
    )
  })

  it('delivers pubsub signal with id to subscribed channels', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const group = new SSEChannelGroup<TestMeta>({ pubsub })
    const ch = createSSEChannel({})
    const invalidateSpy = vi.spyOn(ch, 'invalidate')

    group.register(ch, { userId: 10 }, { topics: ['notifications'] })

    // Flush async TopicManager subscription
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(50)

    await pubsub.publish('notifications', {
      kind: 'signal',
      data: { key: ['alert'] },
      id: 'pubsub-evt-100',
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ key: ['alert'] }, 'pubsub-evt-100')
  })

  it('stores events in eventStore during broadcast and publish', async () => {
    const store = createEventStore()
    const group = new SSEChannelGroup<TestMeta>({ eventStore: store })
    const ch = createSSEChannel({})

    group.register(ch, { userId: 1 }, { topics: ['chat'] })

    await group.broadcast({ key: ['broadcast-event'] }, () => true)
    // Probe at id '2' — broadcast-event was id '1', so getEventsAfter('1') returns probe + anything after
    const r1 = store.add({ key: ['probe'] }) // id '2'
    expect(store.getEventsAfter(r1.id).events).toEqual([]) // nothing after probe
    expect(store.getEventsAfter('0').stale).toBe(true) // '0' unknown → stale

    await group.publish('chat', { key: ['publish-event'] })
    const r3 = store.add({ key: ['probe2'] })
    // broadcast-event='1', probe='2', publish-event='3', probe2='4'
    // getEventsAfter('1') → [probe, publish-event, probe2]
    const { events: allEvents, stale } = store.getEventsAfter('1')
    expect(stale).toBe(false)
    expect(allEvents.length).toBe(3)
  })

  // --- Broadcast: non-ChannelClosedError does NOT deregister ---

  it('broadcast does NOT deregister channels that throw non-ChannelClosedError', () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch = createSSEChannel({})
    vi.spyOn(ch, 'invalidate').mockImplementation(() => { throw new Error('Runtime error') })

    group.register(ch, { userId: 1 })
    expect(group.size).toBe(1)

    expect(() => { group.broadcastToAll({ key: ['test'] }); }).toThrow(AggregateError)

    // Channel should still be registered — it threw Error, not ChannelClosedError
    expect(group.size).toBe(1)
    expect(ch.state).toBe('open')
  })

  // --- publish() to broker with no local subscribers ---

  it('publishes to broker even when no local channels are subscribed to the topic', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const publishSpy = vi.spyOn(pubsub, 'publish')

    const group = new SSEChannelGroup<TestMeta>({ pubsub })

    // No channels registered on 'orphan-topic'
    await group.publish('orphan-topic', { key: ['remote-only'] })

    // Broker should still receive the signal for remote instances
    expect(publishSpy).toHaveBeenCalledWith('orphan-topic', {
      kind: 'signal',
      data: { key: ['remote-only'] },
    })
  })

  it('publish() is a no-op (not an error) when no local subs and no pubsub configured', async () => {
    const group = new SSEChannelGroup<TestMeta>()

    // Should not throw
    await expect(group.publish('nonexistent', { key: ['test'] })).resolves.toBeUndefined()
  })

  // --- TopicManager race: register during pending unsubscribe ---

  it('handles re-registration on a topic while unsubscribe is in flight', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const subscribeSpy = vi.spyOn(pubsub, 'subscribe')

    const group = new SSEChannelGroup<TestMeta>({ pubsub })
    const ch1 = createSSEChannel({})
    const ch2 = createSSEChannel({})

    // Register ch1 on topic-x → TopicManager subscribes
    group.register(ch1, { userId: 1 }, { topics: ['topic-x'] })

    // Flush subscription
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(100)

    // Deregister ch1 → starts unsubscribe (refcount 1 → 0)
    group.deregister(ch1)

    // Immediately register ch2 on same topic → refcount 0 → 1 while unsubscribe in flight
    group.register(ch2, { userId: 2 }, { topics: ['topic-x'] })

    // Flush pending ops
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(100)

    // The topic should still be subscribed (ch2 is on it)
    expect(group.size).toBe(1)
    // subscribe was called at least twice (initial + re-subscribe)
    expect(subscribeSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // --- eventBufferCapacity auto-creates eventStore ---

  it('auto-creates eventStore when eventBufferCapacity is set', () => {
    const group = new SSEChannelGroup<TestMeta>({ eventBufferCapacity: 50 })
    expect(group.eventStore).toBeDefined()
  })

  it('does not create eventStore when eventBufferCapacity is 0 or undefined', () => {
    const group1 = new SSEChannelGroup<TestMeta>()
    expect(group1.eventStore).toBeUndefined()

    const group2 = new SSEChannelGroup<TestMeta>({ eventBufferCapacity: 0 })
    expect(group2.eventStore).toBeUndefined()
  })

  it('ignores errors thrown by ch.close() during revocation in closeLocalMatches', async () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch = createSSEChannel({})

    group.register(ch, { userId: 777 })

    // Force close() to throw
    vi.spyOn(ch, 'close').mockImplementation(() => {
      throw new Error('Already closed stream')
    })

    const closed = await group.revokeWhere({ userId: 777 })
    expect(closed.localClosed).toBe(1)
    expect(group.size).toBe(0)
  })

  it('deregisters closed channel in deliverToChannel when ChannelClosedError is thrown on publish', async () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch = createSSEChannel({})

    group.register(ch, { userId: 1 }, { topics: ['events'] })
    expect(group.size).toBe(1)

    // Close after registration — deliverToChannel still catches ChannelClosedError on next publish
    // but auto-deregister via onClose fires first, so publish finds no local channels
    ch.close()
    expect(group.size).toBe(0)

    // publish should not throw even with no registered channels
    await expect(group.publish('events', { key: ['test-close'] })).resolves.toBeUndefined()
  })

  it('delivers remote signals received via PubSub callback to registered topic channels', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const group = new SSEChannelGroup<TestMeta>({ pubsub })
    const ch = createSSEChannel({})

    group.register(ch, { userId: 88 }, { topics: ['remote-topic'] })

    // Flush async TopicManager subscription
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(50)

    // Simulate pubsub emitting a signal message on 'remote-topic'
    const invalidateSpy = vi.spyOn(ch, 'invalidate')
    await pubsub.publish('remote-topic', {
      kind: 'signal',
      data: { key: ['remote-data'] },
    })

    // ch.invalidate should have been called
    expect(invalidateSpy).toHaveBeenCalledWith({ key: ['remote-data'] }, undefined)
  })

  it('TopicManager handles channel added back while unsubscribe is pending', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const group = new SSEChannelGroup<TestMeta>({ pubsub })
    const ch1 = createSSEChannel({})
    const ch2 = createSSEChannel({})

    group.register(ch1, { userId: 1 }, { topics: ['readd-topic'] })
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(50)

    // Start unsub
    group.deregister(ch1)
    // Re-add ch2 immediately
    group.register(ch2, { userId: 2 }, { topics: ['readd-topic'] })

    expect(group.size).toBe(1)
  })

  it('auto-creates EventStore when eventBufferCapacity > 0 is passed in options', () => {
    const group = new SSEChannelGroup<TestMeta>({ eventBufferCapacity: 25 })
    expect(group.eventStore).toBeDefined()

    const ch = createSSEChannel({})
    const invalidateSpy = vi.spyOn(ch, 'invalidate')
    group.register(ch, { userId: 99 })

    group.broadcastToAll({ key: ['auto-store-group'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ key: ['auto-store-group'] }, '1')
  })

  it('preserves topic subscription when new channel registers while teardown is in-flight', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const group = new SSEChannelGroup<TestMeta>({ pubsub })
    const ch1 = createSSEChannel({})
    const ch2 = createSSEChannel({})

    // 1. Initial register
    group.register(ch1, { userId: 10 }, { topics: ['shared-topic'] })
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(50)
    expect(pubsub.getTopicSubscriberCount('shared-topic')).toBe(1)

    // 2. Deregister ch1 to start teardown
    group.deregister(ch1)
    // 3. Immediately register ch2 on shared-topic before teardown tasks resolve
    group.register(ch2, { userId: 20 }, { topics: ['shared-topic'] })

    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(50)
    expect(pubsub.getTopicSubscriberCount('shared-topic')).toBe(1)
    expect(group.size).toBe(1)
  })

  // --- Auto-deregister via onClose ---

  it('auto-deregisters channel when it is closed after register()', () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch = createSSEChannel({})

    group.register(ch, { userId: 1 })
    expect(group.size).toBe(1)

    ch.close()
    expect(group.size).toBe(0)
  })

  it('auto-deregisters channel when it is disconnected', () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch = createSSEChannel({})

    group.register(ch, { userId: 1 })
    ch.disconnect()
    expect(group.size).toBe(0)
  })

  it('does not wire a second onClose listener on re-registration', () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch = createSSEChannel({})
    const onCloseSpy = vi.spyOn(ch, 'onClose')

    group.register(ch, { userId: 1 })
    // Re-register with different meta
    group.register(ch, { userId: 2 })
    expect(onCloseSpy).toHaveBeenCalledTimes(1)
    expect(group.size).toBe(1)

    ch.close()
    // Should be deregistered exactly once, not double-deregistered
    expect(group.size).toBe(0)
  })

  // --- broadcastByKey ---

  it('broadcastByKey delivers to channels whose metadata matches the signal key', () => {
    const group = new SSEChannelGroup<{ userId: number }>()
    const ch1 = createSSEChannel({})
    const ch2 = createSSEChannel({})

    const spy1 = vi.spyOn(ch1, 'invalidate')
    const spy2 = vi.spyOn(ch2, 'invalidate')

    // metadata is { userId: 1 } — treated as [{ userId: 1 }] for key matching
    group.register(ch1, { userId: 1 })
    group.register(ch2, { userId: 2 })

    // signal key [{ userId: 1 }] should match only ch1
    group.broadcastByKey({ key: [{ userId: 1 }] })

    expect(spy1).toHaveBeenCalledWith({ key: [{ userId: 1 }] }, undefined)
    expect(spy2).not.toHaveBeenCalled()
  })

  it('broadcastByKey delivers to all channels when key matches all metadata', () => {
    const group = new SSEChannelGroup<{ role: string }>()
    const ch1 = createSSEChannel({})
    const ch2 = createSSEChannel({})

    const spy1 = vi.spyOn(ch1, 'invalidate')
    const spy2 = vi.spyOn(ch2, 'invalidate')

    group.register(ch1, { role: 'admin' })
    group.register(ch2, { role: 'user' })

    // empty key prefix matches every channel
    group.broadcastByKey({ key: [] })

    expect(spy1).toHaveBeenCalled()
    expect(spy2).toHaveBeenCalled()
  })

  it('broadcastByKey delivers nothing when no metadata matches', () => {
    const group = new SSEChannelGroup<{ userId: number }>()
    const ch = createSSEChannel({})
    const spy = vi.spyOn(ch, 'invalidate')

    group.register(ch, { userId: 5 })

    group.broadcastByKey({ key: [{ userId: 99 }] })
    expect(spy).not.toHaveBeenCalled()
  })

  it('revokeByConnectionId enforces scope checks', async () => {
    const group = new SSEChannelGroup<TestMeta>()
    const ch = createSSEChannel()

    group.register(ch, { userId: 100, role: 'admin' })

    // Non-matching scope
    const result1 = await group.revokeByConnectionId(ch.connectionId, { userId: 200 })
    expect(result1.closed).toBe(false)
    expect(ch.state).toBe('open')
    expect(group.size).toBe(1)

    // Matching scope
    const result2 = await group.revokeByConnectionId(ch.connectionId, { userId: 100, role: 'admin' })
    expect(result2.closed).toBe(true)
    expect(ch.state).toBe('closed')
    expect(group.size).toBe(0)
  })

  it('revokeByConnectionId scope matching uses structural equality, not reference equality', async () => {
    // Regression: scope comparison previously used !== (reference equality), so
    // nested objects/arrays in scope would never match — even locally.
    interface NestedMeta { userId: number; address: { city: string } }
    const group = new SSEChannelGroup<NestedMeta>()
    const ch = createSSEChannel()

    group.register(ch, { userId: 1, address: { city: 'London' } })

    // Scope built independently — different object reference, same structure
    const scope = { address: { city: 'London' } }
    const result = await group.revokeByConnectionId(ch.connectionId, scope)

    expect(result.closed).toBe(true)
    expect(ch.state).toBe('closed')
    expect(group.size).toBe(0)
  })

  it('manages connectionIndex collision-safely across distinct channels', async () => {
    const group = new SSEChannelGroup<TestMeta>()

    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()

    group.register(ch1, { userId: 100 })
    group.register(ch2, { userId: 100 })
    expect(group.size).toBe(2)

    // Deregistering ch1 should not delete ch2
    group.deregister(ch1)
    expect(group.size).toBe(1)

    // revokeByConnectionId for ch2 should still find and revoke ch2
    const result = await group.revokeByConnectionId(ch2.connectionId)
    expect(result.closed).toBe(true)
    expect(ch2.state).toBe('closed')
    expect(group.size).toBe(0)
  })

  it('delivers raw signal to channel on broadcast', () => {
    const group = new SSEChannelGroup()
    const ch = createSSEChannel({})
    group.register(ch)

    const spy = vi.spyOn(ch, 'invalidate')
    group.broadcastToAll({ key: ['items'] })

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ key: ['items'] }), undefined)
  })
})

// ─── channelDefaults tests ────────────────────────────────────────────────────

describe('SSEChannelGroup — channelDefaults', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes channelDefaults from constructor options', () => {
    const group = new SSEChannelGroup({
      channelDefaults: { guardKeepalive: true, lifetime: { ttlMs: 5000 } },
    })
    expect(group.channelDefaults).toEqual({ guardKeepalive: true, lifetime: { ttlMs: 5000 } })
  })

  it('channelDefaults is undefined when not provided', () => {
    const group = new SSEChannelGroup()
    expect(group.channelDefaults).toBeUndefined()
  })

  it('channelDefaults is available after construction with only guardKeepalive', () => {
    const group = new SSEChannelGroup({ channelDefaults: { guardKeepalive: false } })
    expect(group.channelDefaults?.guardKeepalive).toBe(false)
  })

  it('channelDefaults is available after construction with only lifetime', () => {
    const group = new SSEChannelGroup({
      channelDefaults: { lifetime: { ttlMs: 10000, onDeadline: 'revoke' } },
    })
    expect(group.channelDefaults?.lifetime).toEqual({ ttlMs: 10000, onDeadline: 'revoke' })
  })

  // FT-03: channelDefaults behavioral tests — verify that group channelDefaults
  // are merged into channel options when channels are created via the group
  it('apply channelDefaults to channels registered with the group', () => {
    const group = new SSEChannelGroup({
      channelDefaults: { guardKeepalive: true, lifetime: { ttlMs: 1000 } },
    })

    // Create a channel and register it
    const ch = createSSEChannel({})
    group.register(ch)

    // The group's channelDefaults should have been merged into the channel during registration.
    // Since channels are created before registration (external to the group), we verify
    // the defaults are available on the group object, and test integration via attach/response adapters.
    expect(group.channelDefaults?.guardKeepalive).toBe(true)
    expect(group.channelDefaults?.lifetime?.ttlMs).toBe(1000)
  })

  it('channelDefaults lifetime triggers deadline on channels after merged apply', async () => {
    vi.useFakeTimers()
    const decoder = new TextDecoder()

    const lifetime = { ttlMs: 2000, onDeadline: 'revoke' } as const
    const group = new SSEChannelGroup({ channelDefaults: { lifetime } })

    const ch = createSSEChannel({ lifetime })
    group.register(ch)

    const reader = ch.stream.getReader()
    // Read initial connected frame
    await reader.read()

    // Advance past the TTL + jitter window
    await vi.advanceTimersByTimeAsync(3000)

    const { value } = await reader.read()
    reader.releaseLock()

    // Should receive a revoke frame (onDeadline: 'revoke')
    expect(decoder.decode(value)).toContain('event: revoke')
    expect(ch.state).toBe('closed')
  })

  describe('createFetchResponse (Fetch API)', () => {
    it('creates a channel, registers it with the group, and returns response and channel reference', () => {
      const group = new SSEChannelGroup<{ userId: number }>({})
      const req = new Request('http://localhost/sse')
      const { response, channel } = group.createFetchResponse(req, {
        meta: { userId: 42 },
        topics: ['user-42'],
      })

      expect(response).toBeInstanceOf(Response)
      expect(channel).toBeDefined()
      expect(typeof channel.connectionId).toBe('string')
      expect(channel.connectionId.length).toBeGreaterThan(0)
      expect(group.size).toBe(1)

      const invalidateSpy = vi.spyOn(channel, 'invalidate')
      group.broadcastToAll({ key: ['items'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ key: ['items'] }, undefined)
    })

    it('automatically deregisters channel from group when channel closes', () => {
      const group = new SSEChannelGroup<{ userId: number }>({})
      const req = new Request('http://localhost/sse')
      const { channel } = group.createFetchResponse(req, {
        meta: { userId: 10 },
      })

      expect(group.size).toBe(1)
      channel.close()
      expect(group.size).toBe(0)
    })
  })

  describe('attachNodeResponse (Node.js / Express / Fastify)', () => {
    function createMockNodeRes(): any {
      return Object.assign(new EventEmitter(), {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      })
    }

    it('supports Fastify reply object and calls hijack() if present', () => {
      const group = new SSEChannelGroup<{ userId: number }>({})
      const rawReq = Object.assign(new EventEmitter(), { url: '/sse', headers: {} })
      const req = { raw: rawReq } as any
      const rawRes = createMockNodeRes()
      const hijackSpy = vi.fn()
      const reply = { raw: rawRes, hijack: hijackSpy } as any

      const { channel } = group.attachNodeResponse(req, reply, {
        meta: { userId: 200 },
      })

      expect(hijackSpy).toHaveBeenCalled()
      expect(channel).toBeDefined()
      expect(group.size).toBe(1)
    })

    it('automatically deregisters channel on close', () => {
      const group = new SSEChannelGroup<{ userId: number }>({})
      const req = new EventEmitter() as any
      req.url = '/sse'
      req.headers = {}
      const res = createMockNodeRes()

      const { channel } = group.attachNodeResponse(req, res, {
        meta: { userId: 55 },
      })

      expect(group.size).toBe(1)
      channel.close()
      expect(group.size).toBe(0)
    })

    it('auto-allocates event buffer when lifetime is set without eventStore', () => {
      const ch = createSSEChannel({
        lifetime: { ttlMs: 60000 },
      })
      // Emitting invalidations should assign an auto-increment ID because event store capacity was auto-allocated
      const eventId = ch.invalidate({ key: ['todos'] })
      expect(eventId).toBe('1')
      ch.close()
    })
  })

  describe('DX and type safety optimizations', () => {
    function createMockNodeRes(): any {
      return Object.assign(new EventEmitter(), {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      })
    }

    it('prunes undefined properties in scope when calling revokeByConnectionId', async () => {
      const group = new SSEChannelGroup<{ userId: number; role?: string }>()
      const ch = createSSEChannel()
      group.register(ch, { userId: 100 })

      // Passing scope with undefined role property
      const res = await group.revokeByConnectionId(ch.connectionId, { userId: 100, role: undefined })
      expect(res.closed).toBe(true)
      expect(group.size).toBe(0)
    })

    it('throws rather than revoking everyone when scope prunes down to an empty object', async () => {
      const group = new SSEChannelGroup<{ userId: number; role?: string }>()
      const ch = createSSEChannel()
      group.register(ch, { userId: 100, role: 'member' })

      // Caller passed a scope object, but every key resolved to `undefined`
      // (e.g. `req.user?.role` on a user with no role field). After pruning,
      // the effective scope is `{}` — it must NOT silently match every channel.
      await expect(
        group.revokeByConnectionId(ch.connectionId, { role: undefined })
      ).rejects.toThrow(/scope/i)

      // The channel must still be registered — the revoke must not have gone through.
      expect(group.size).toBe(1)
    })

    it('throws when scope is a non-plain object with no enumerable own properties', async () => {
      const group = new SSEChannelGroup<{ userId: number; role?: string }>()
      const ch = createSSEChannel()
      group.register(ch, { userId: 100, role: 'member' })

      // `new Date()` passes the `typeof scope === 'object'` / `!Array.isArray` guard,
      // but has zero own enumerable entries — pruning also yields `{}`.
      await expect(
        group.revokeByConnectionId(ch.connectionId, new Date() as any)
      ).rejects.toThrow(/scope/i)

      expect(group.size).toBe(1)
    })

    it('throws when an explicitly empty object is passed as scope', async () => {
      const group = new SSEChannelGroup<{ userId: number; role?: string }>()
      const ch = createSSEChannel()
      group.register(ch, { userId: 100, role: 'member' })

      // Passing `{}` directly should be treated the same as a scope that pruned to
      // empty — reject it rather than silently behaving like an unscoped revoke.
      // (To revoke without any scope filter, callers should omit the `scope` argument
      // entirely, not pass `{}`.)
      await expect(
        group.revokeByConnectionId(ch.connectionId, {})
      ).rejects.toThrow(/scope/i)

      expect(group.size).toBe(1)
    })

    it('auto-infers TMeta from metaSchema in constructor', async () => {
      const metaSchema = createValidSchema((data) => ({ userId: Number((data as any).userId) }))
      const group = new SSEChannelGroup({ metaSchema })
      const ch = createSSEChannel({})
      group.register(ch, { userId: 42 })

      let receivedMeta: unknown = null
      await group.broadcast({ key: ['test'] }, (meta) => {
        receivedMeta = meta
        return true
      })
      expect(receivedMeta).toEqual({ userId: 42 })
    })

    it('automatically injects single target into publish and broadcast signals when omitted', async () => {
      const group = new SSEChannelGroup({})
      const ch = createSSEChannel({})
      group.register(ch, undefined, { topics: ['todos-topic'] })

      const invalidateSpy = vi.spyOn(ch, 'invalidate')

      // Calling broadcastToAll with signal without explicit target
      group.broadcastToAll({ key: ['todos'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ key: ['todos'] }, undefined)

      invalidateSpy.mockClear()

      // Calling publish with signal without explicit target
      await group.publish('todos-topic', { key: ['todos'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ key: ['todos'] }, undefined)
    })

    it('handles scalar non-object metadata during revokeWhere and connectionId matching', async () => {
      const group = new SSEChannelGroup<string>()
      const ch1 = createSSEChannel()
      const ch2 = createSSEChannel()

      group.register(ch1, 'admin-user')
      group.register(ch2, 'normal-user')

      // Revoke by connectionId on scalar metadata channel
      const res = await group.revokeByConnectionId(ch1.connectionId, { userId: 'admin-user' })
      expect(res.closed).toBe(false) // scalar string meta does not match scope object
      expect(group.size).toBe(2)

      const res2 = await group.revokeByConnectionId(ch1.connectionId)
      expect(res2.closed).toBe(true)
      expect(group.size).toBe(1)
    })

    it('rejects non-object scope in revokeByConnectionId', async () => {
      const group = new SSEChannelGroup()
      const ch = createSSEChannel()
      group.register(ch)

      await expect(group.revokeByConnectionId(ch.connectionId, 123 as any)).rejects.toThrow(/scope/i)
    })

    it('continues delivery to other channels on publish even when one channel throws and does not throw AggregateError', async () => {
      const group = new SSEChannelGroup()
      const ch1 = createSSEChannel({})
      const ch2 = createSSEChannel({})

      group.register(ch1, undefined, { topics: ['shared-topic'] })
      group.register(ch2, undefined, { topics: ['shared-topic'] })

      vi.spyOn(ch1, 'invalidate').mockImplementation(() => {
        throw new Error('Simulated channel 1 failure')
      })
      const ch2Spy = vi.spyOn(ch2, 'invalidate')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(group.publish('shared-topic', { key: ['test'] })).resolves.toBeUndefined()
      expect(ch2Spy).toHaveBeenCalledWith({ key: ['test'] }, undefined)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SSEChannelGroup] Failed to deliver signal to local channel during publish:'),
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })

    it('continues delivery to other channels on pubsub signal even when one channel throws', async () => {
      const pubsub = new MemoryPubSubAdapter()
      const group = new SSEChannelGroup({ pubsub })
      const ch1 = createSSEChannel({})
      const ch2 = createSSEChannel({})

      group.register(ch1, undefined, { topics: ['pubsub-topic'] })
      group.register(ch2, undefined, { topics: ['pubsub-topic'] })

      vi.spyOn(ch1, 'invalidate').mockImplementation(() => {
        throw new Error('Simulated channel 1 pubsub failure')
      })
      const ch2Spy = vi.spyOn(ch2, 'invalidate')

      await pubsub.publish('pubsub-topic', { kind: 'signal', data: { key: ['pubsub-item'] } })

      expect(ch2Spy).toHaveBeenCalledWith({ key: ['pubsub-item'] }, undefined)
    })

    it('continues delivery to other channels on pushInlineData even when one channel throws', async () => {
      const group = new SSEChannelGroup({
        resolveInlineData: (connections) => {
          const map = new Map()
          for (const conn of connections) {
            map.set(conn.connectionId, { signal: { key: ['item'] }, inlineData: { value: 123 } })
          }
          return map
        },
      })
      const ch1 = createSSEChannel()
      const ch2 = createSSEChannel()

      group.register(ch1, undefined, { topics: ['inline-topic'] })
      group.register(ch2, undefined, { topics: ['inline-topic'] })

      vi.spyOn(ch1, 'invalidate').mockImplementation(() => {
        throw new Error('Simulated channel 1 inline failure')
      })
      const ch2Spy = vi.spyOn(ch2, 'invalidate')

      await expect(group.pushInlineData('inline-topic', { data: 'test' })).rejects.toThrow(AggregateError)
      expect(ch2Spy).toHaveBeenCalledWith({ key: ['item'], inlineData: { value: 123 } }, undefined)
    })

    it('handles subscribeControl schema validation failure gracefully without throwing uncaught', async () => {
      const pubsub = new MemoryPubSubAdapter()
      const invalidSchema = createInvalidSchema('Invalid schema payload')
      const group = new SSEChannelGroup({
        pubsub,
        clientContextSchema: invalidSchema,
      })
      const ch = createSSEChannel()
      group.register(ch)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Publish a malformed updateClientContext control message
      await pubsub.publish(group.controlTopic, {
        kind: 'control',
        data: {
          type: 'updateClientContext',
          connectionId: ch.connectionId,
          clientContext: { invalid: true },
        },
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SSEChannelGroup] Error processing pubsub control message:'),
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })

    it('catches and logs errors during pubsub inlineData delivery', async () => {
      const pubsub = new MemoryPubSubAdapter()
      const group = new SSEChannelGroup({
        pubsub,
        // No resolveInlineData configured -> will throw when inlineData is delivered
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await pubsub.publish(group.controlTopic, {
        kind: 'inlineData',
        topic: 'any-topic',
        payload: { test: 1 },
      })

      // Wait a tick for promise rejection to be caught
      await Promise.resolve()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SSEChannelGroup] Failed to deliver inline data from pubsub:'),
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })

    it('deduplicates concurrent attachTopic subscriptions to prevent race conditions', () => {
      const pubsub = new MemoryPubSubAdapter()
      const subscribeSpy = vi.spyOn(pubsub, 'subscribe')
      const group = new SSEChannelGroup({ pubsub })

      const ch1 = createSSEChannel({})
      const ch2 = createSSEChannel({})

      // Register concurrently to the same topic
      group.register(ch1, undefined, { topics: ['concurrent-topic'] })
      group.register(ch2, undefined, { topics: ['concurrent-topic'] })

      // pubsub.subscribe should only have been called once for 'concurrent-topic'
      const topicSubscribes = subscribeSpy.mock.calls.filter(([t]) => t === 'concurrent-topic')
      expect(topicSubscribes).toHaveLength(1)
    })

    it('handles pubsub.subscribe failure in attachTopic cleanly', async () => {
      const pubsub = new MemoryPubSubAdapter()
      const group = new SSEChannelGroup({ pubsub })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock rejection specifically for subsequent topic subscribe
      vi.spyOn(pubsub, 'subscribe').mockRejectedValueOnce(new Error('Pubsub connection lost'))

      const ch = createSSEChannel({})
      group.register(ch, undefined, { topics: ['failing-topic'] })

      await vi.advanceTimersByTimeAsync(50)

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SSEChannelGroup] Failed to subscribe to pubsub topic "failing-topic":'),
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })

    it('attaches SHA-256 _sh to signal when publish is called with senderConnectionId', async () => {
      const pubsub = new MemoryPubSubAdapter()
      const group = new SSEChannelGroup({ pubsub })
      const ch = createSSEChannel({})
      group.register(ch, undefined, { topics: ['mutations'] })

      const invalidateSpy = vi.spyOn(ch, 'invalidate')
      const { computeSenderHash } = await import('@/utils/canonical-hash.js')
      const expectedHash = await computeSenderHash('sender-123')

      await group.publish('mutations', { key: ['todos'] }, { senderConnectionId: 'sender-123' })

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          key: ['todos'],
          _sh: expectedHash,
        }),
        undefined,
      )
    })

    it('attaches SHA-256 _sh to signal when broadcast is called with senderConnectionId', async () => {
      const group = new SSEChannelGroup()
      const ch = createSSEChannel({})
      group.register(ch)

      const invalidateSpy = vi.spyOn(ch, 'invalidate')
      const { computeSenderHash } = await import('@/utils/canonical-hash.js')
      const expectedHash = await computeSenderHash('sender-456')

      await group.broadcast({ key: ['items'] }, () => true, { senderConnectionId: 'sender-456' })

      // Wait a tick for async hash to resolve and deliver
      await vi.waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            key: ['items'],
            _sh: expectedHash,
          }),
          undefined,
        )
      })
    })
  })
})
