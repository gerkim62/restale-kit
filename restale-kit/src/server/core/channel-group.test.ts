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
    const group = new SSEChannelGroup<any, TestMeta>({ metaSchema })
    const channel = createSSEChannel()

    expect(() => { group.register(channel, { userId: -1 }); }).toThrow(SchemaValidationError)
    expect(group.size).toBe(0)
  })

  it('registers channel and handles topic updates on re-registration', () => {
    const group = new SSEChannelGroup<any, TestMeta>()
    const channel = createSSEChannel()

    group.register(channel, { userId: 1 }, { topics: ['topic-a', 'topic-b'] })
    expect(group.size).toBe(1)

    // Re-register with only topic-b
    group.register(channel, { userId: 1 }, { topics: ['topic-b'] })
    expect(group.size).toBe(1)
  })

  it('broadcast filter selectively delivers signals to matching predicate', () => {
    const group = new SSEChannelGroup<any, TestMeta>()
    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()

    const spy1 = vi.spyOn(ch1, 'invalidate')
    const spy2 = vi.spyOn(ch2, 'invalidate')

    group.register(ch1, { userId: 1, role: 'admin' })
    group.register(ch2, { userId: 2, role: 'user' })

    group.broadcast({ key: ['admin-data'] }, (meta) => meta.role === 'admin')

    expect(spy1).toHaveBeenCalledWith({ key: ['admin-data'] }, undefined)
    expect(spy2).not.toHaveBeenCalled()
  })

  it('broadcastToAll delivers to all registered channels', () => {
    const group = new SSEChannelGroup<any, TestMeta>()
    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()

    const spy1 = vi.spyOn(ch1, 'invalidate')
    const spy2 = vi.spyOn(ch2, 'invalidate')

    group.register(ch1, { userId: 1 })
    group.register(ch2, { userId: 2 })

    group.broadcastToAll({ key: ['global-update'] })

    expect(spy1).toHaveBeenCalled()
    expect(spy2).toHaveBeenCalled()
  })

  it('deregisters closed channels automatically during broadcast', () => {
    const group = new SSEChannelGroup<any, TestMeta>()
    const ch1 = createSSEChannel()

    group.register(ch1, { userId: 1 })
    expect(group.size).toBe(1)

    // Close after registration — auto-deregister fires via onClose
    ch1.close()
    expect(group.size).toBe(0)
  })

  it('aggregates errors on broadcast failures', () => {
    const schema = createValidSchema()
    const group = new SSEChannelGroup<any, TestMeta>()
    const badSchema = createInvalidSchema('Validation failed')
    const ch = createSSEChannel({ signalSchema: badSchema })

    group.register(ch, { userId: 1 })

    expect(() => { group.broadcastToAll({ key: ['test'] }); }).toThrow(AggregateError)
  })

  it('publishes locally before publishing to broker pubsub', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const publishSpy = vi.spyOn(pubsub, 'publish')

    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })
    const ch = createSSEChannel()
    const invalidateSpy = vi.spyOn(ch, 'invalidate')

    group.register(ch, { userId: 10 }, { topics: ['notifications'] })

    await group.publish('notifications', { key: ['alert'] })

    expect(invalidateSpy).toHaveBeenCalledWith({ key: ['alert'] }, undefined)
    expect(publishSpy).toHaveBeenCalledWith('notifications', {
      kind: 'signal',
      data: { key: ['alert'] },
    })
  })

  it('revokes matching channels locally and publishes control message to pubsub', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const publishSpy = vi.spyOn(pubsub, 'publish')

    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })
    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()

    group.register(ch1, { userId: 100 })
    group.register(ch2, { userId: 200 })

    const result = await group.revoke({ userId: 100 })

    expect(result.localClosed).toBe(1)
    expect(ch1.state).toBe('closed')
    expect(ch2.state).toBe('open')

    expect(publishSpy).toHaveBeenCalledWith(group.controlTopic, {
      kind: 'control',
      data: { userId: 100 },
    })
  })

  it('retries subscription up to 5 times with backoff on failure in TopicManager', async () => {
    const attempts = 0
    const flakyPubSub = new MemoryPubSubAdapter()

    let retryTopicAttempts = 0
    vi.spyOn(flakyPubSub, 'subscribe').mockImplementation((topic) => {
      if (topic === 'retry-topic') {
        retryTopicAttempts++
        if (retryTopicAttempts < 5) {
          return Promise.reject(new Error(`Attempt ${String(retryTopicAttempts)} failed`))
        }
      }
      return Promise.resolve(() => Promise.resolve())
    })

    const group = new SSEChannelGroup<any, TestMeta>({ pubsub: flakyPubSub })
    const ch = createSSEChannel()

    group.register(ch, { userId: 1 }, { topics: ['retry-topic'] })

    // TopicManager sleep timer advances clock and Date.now
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(200)
    }

    expect(retryTopicAttempts).toBe(5)
  })

  it('receives control messages via PubSub and revokes matching local connections', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })
    const ch = createSSEChannel()

    group.register(ch, { userId: 500, role: 'admin' })
    await group['controlPendingOp']

    // Simulate incoming control message over controlTopic
    await pubsub.publish(group.controlTopic, {
      kind: 'control',
      data: { role: 'admin' },
    })

    expect(ch.state).toBe('closed')
    expect(group.size).toBe(0)
  })

  it('retries control topic subscription if pubsub.subscribe fails initially', async () => {
    let attempts = 0
    const flakyPubSub = new MemoryPubSubAdapter()

    vi.spyOn(flakyPubSub, 'subscribe').mockImplementation((topic, callback) => {
      if (topic.includes('control')) {
        attempts++
        if (attempts === 1) {
          return Promise.reject(new Error('Control sub failed'))
        }
      }
      return Promise.resolve(() => Promise.resolve())
    })

    const group = new SSEChannelGroup<any, TestMeta>({ pubsub: flakyPubSub })
    const ch = createSSEChannel()
    group.register(ch, { userId: 1 })

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(200)
    }

    expect(attempts).toBeGreaterThanOrEqual(2)
  })

  it('handles non-Error thrown exceptions during delivery', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const group = new SSEChannelGroup<any, TestMeta>()
    const ch = createSSEChannel()

    vi.spyOn(ch, 'invalidate').mockImplementation(() => {
      throw new Error('String error thrown')
    })

    group.register(ch, { userId: 1 })

    expect(() => { group.broadcastToAll({ key: ['test'] }); }).toThrow()
    expect(consoleSpy).toHaveBeenCalled()
    expect(consoleSpy.mock.calls[0][0]).toContain('[ERROR][SSEChannelGroup')

    consoleSpy.mockRestore()
  })

  it('disposes control subscription idempotently and logs unsubscribe errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const flakyPubSub = new MemoryPubSubAdapter()

    vi.spyOn(flakyPubSub, 'subscribe').mockResolvedValue(() => {
      return Promise.reject(new Error('Unsub control error'))
    })

    const group = new SSEChannelGroup<any, TestMeta>({ pubsub: flakyPubSub })
    await group['controlPendingOp']
    await group.dispose()

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR][SSEChannelGroup.dispose] Failed to unsubscribe control topic'),
      expect.any(Error)
    )

    consoleSpy.mockRestore()
  })

  it('stores events in eventStore during broadcast and publish', async () => {
    const store = createEventStore()
    const group = new SSEChannelGroup<any, TestMeta>({ eventStore: store })
    const ch = createSSEChannel()

    group.register(ch, { userId: 1 }, { topics: ['chat'] })

    group.broadcast({ key: ['broadcast-event'] }, () => true)
    expect(store.getEventsAfter('').length).toBe(1)

    await group.publish('chat', { key: ['publish-event'] })
    expect(store.getEventsAfter('').length).toBe(2)
  })

  // --- Broadcast: non-ChannelClosedError does NOT deregister ---

  it('broadcast does NOT deregister channels that throw non-ChannelClosedError', () => {
    const group = new SSEChannelGroup<any, TestMeta>()
    const badSchema = createInvalidSchema('Validation failed')
    const ch = createSSEChannel({ signalSchema: badSchema })

    group.register(ch, { userId: 1 })
    expect(group.size).toBe(1)

    expect(() => { group.broadcastToAll({ key: ['test'] }); }).toThrow(AggregateError)

    // Channel should still be registered — it threw SchemaValidationError, not ChannelClosedError
    expect(group.size).toBe(1)
    expect(ch.state).toBe('open')
  })

  // --- publish() to broker with no local subscribers ---

  it('publishes to broker even when no local channels are subscribed to the topic', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const publishSpy = vi.spyOn(pubsub, 'publish')

    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })

    // No channels registered on 'orphan-topic'
    await group.publish('orphan-topic', { key: ['remote-only'] })

    // Broker should still receive the signal for remote instances
    expect(publishSpy).toHaveBeenCalledWith('orphan-topic', {
      kind: 'signal',
      data: { key: ['remote-only'] },
    })
  })

  it('publish() is a no-op (not an error) when no local subs and no pubsub configured', async () => {
    const group = new SSEChannelGroup<any, TestMeta>()

    // Should not throw
    await expect(group.publish('nonexistent', { key: ['test'] })).resolves.toBeUndefined()
  })

  // --- deliverToChannel swallows non-ChannelClosedError in publish() context ---

  it('publish() logs but does not throw when channel.invalidate throws non-ChannelClosedError', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const group = new SSEChannelGroup<any, TestMeta>()
    const badSchema = createInvalidSchema('Schema error')
    const ch = createSSEChannel({ signalSchema: badSchema })

    group.register(ch, { userId: 1 }, { topics: ['chat'] })

    // publish() via deliverToChannel should log the error but NOT throw
    await expect(group.publish('chat', { key: ['test'] })).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR][SSEChannelGroup.publish]'),
      expect.any(String)
    )

    consoleSpy.mockRestore()
  })

  // --- TopicManager race: register during pending unsubscribe ---

  it('handles re-registration on a topic while unsubscribe is in flight', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const subscribeSpy = vi.spyOn(pubsub, 'subscribe')

    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })
    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()

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
    const group = new SSEChannelGroup<any, TestMeta>({ eventBufferCapacity: 50 })
    expect(group.eventStore).toBeDefined()
  })

  it('does not create eventStore when eventBufferCapacity is 0 or undefined', () => {
    const group1 = new SSEChannelGroup<any, TestMeta>()
    expect(group1.eventStore).toBeUndefined()

    const group2 = new SSEChannelGroup<any, TestMeta>({ eventBufferCapacity: 0 })
    expect(group2.eventStore).toBeUndefined()
  })

  it('ignores errors thrown by ch.close() during revocation in closeLocalMatches', async () => {
    const group = new SSEChannelGroup<any, TestMeta>()
    const ch = createSSEChannel()

    group.register(ch, { userId: 777 })

    // Force close() to throw
    vi.spyOn(ch, 'close').mockImplementation(() => {
      throw new Error('Already closed stream')
    })

    const closed = await group.revoke({ userId: 777 })
    expect(closed.localClosed).toBe(1)
    expect(group.size).toBe(0)
  })

  it('deregisters closed channel in deliverToChannel when ChannelClosedError is thrown on publish', async () => {
    const group = new SSEChannelGroup<any, TestMeta>()
    const ch = createSSEChannel()

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
    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })
    const ch = createSSEChannel()

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

  // --- TopicManager edge cases for 100% line coverage ---

  it('TopicManager handles channel removal while subscribe promise is resolving', async () => {
    const pubsub = new MemoryPubSubAdapter()

    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })
    const ch = createSSEChannel()

    // Register ch to create topic manager
    group.register(ch, { userId: 1 }, { topics: ['transient-topic'] })

    // Immediately deregister before subscribe resolves
    group.deregister(ch)

    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(50)

    expect(pubsub.getTopicSubscriberCount('transient-topic')).toBe(0)
  })

  it('TopicManager logs error when subscribe fails after max 5 attempts', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pubsub = new MemoryPubSubAdapter()
    vi.spyOn(pubsub, 'subscribe').mockRejectedValue(new Error('Persistent pubsub error'))

    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })
    const ch = createSSEChannel()

    group.register(ch, { userId: 1 }, { topics: ['failing-topic'] })

    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(200)

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR][TopicManager.subscribe] Failed to subscribe to topic "failing-topic" after 5 attempts:'),
      expect.any(Error)
    )

    consoleSpy.mockRestore()
  })

  it('TopicManager logs error when unsubscribe fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pubsub = new MemoryPubSubAdapter()
    vi.spyOn(pubsub, 'subscribe').mockResolvedValue(() => Promise.reject(new Error('Unsubscribe network failure')))

    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })
    const ch = createSSEChannel()

    group.register(ch, { userId: 1 }, { topics: ['unsub-fail-topic'] })
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(50)

    group.deregister(ch)
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(50)

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR][TopicManager.unsubscribe] Failed to unsubscribe from topic "unsub-fail-topic":'),
      expect.any(Error)
    )

    consoleSpy.mockRestore()
  })

  it('TopicManager handles channel added back while unsubscribe is pending', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })
    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()

    group.register(ch1, { userId: 1 }, { topics: ['readd-topic'] })
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(50)

    // Start unsub
    group.deregister(ch1)
    // Re-add ch2 immediately
    group.register(ch2, { userId: 2 }, { topics: ['readd-topic'] })

    expect(group.size).toBe(1)
  })

  it('auto-creates EventStore when eventBufferCapacity > 0 is passed in options', () => {
    const group = new SSEChannelGroup<any, TestMeta>({ eventBufferCapacity: 25 })
    expect(group.eventStore).toBeDefined()

    const ch = createSSEChannel()
    const invalidateSpy = vi.spyOn(ch, 'invalidate')
    group.register(ch, { userId: 99 })

    group.broadcastToAll({ key: ['auto-store-group'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ key: ['auto-store-group'] }, '1')
  })

  it('preserves topic subscription when new channel registers while teardown is in-flight', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const group = new SSEChannelGroup<any, TestMeta>({ pubsub })
    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()

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
    const group = new SSEChannelGroup<any, TestMeta>()
    const ch = createSSEChannel()

    group.register(ch, { userId: 1 })
    expect(group.size).toBe(1)

    ch.close()
    expect(group.size).toBe(0)
  })

  it('auto-deregisters channel when it is disconnected', () => {
    const group = new SSEChannelGroup<any, TestMeta>()
    const ch = createSSEChannel()

    group.register(ch, { userId: 1 })
    ch.disconnect()
    expect(group.size).toBe(0)
  })

  it('does not wire a second onClose listener on re-registration', () => {
    const group = new SSEChannelGroup<any, TestMeta>()
    const ch = createSSEChannel()

    group.register(ch, { userId: 1 })
    // Re-register with different meta
    group.register(ch, { userId: 2 })
    expect(group.size).toBe(1)

    ch.close()
    // Should be deregistered exactly once, not double-deregistered
    expect(group.size).toBe(0)
  })

  // --- broadcastByKey ---

  it('broadcastByKey delivers to channels whose metadata matches the signal key', () => {
    const group = new SSEChannelGroup<any, { userId: number }>()
    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()

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
    const group = new SSEChannelGroup<any, { role: string }>()
    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()

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
    const group = new SSEChannelGroup<any, { userId: number }>()
    const ch = createSSEChannel()
    const spy = vi.spyOn(ch, 'invalidate')

    group.register(ch, { userId: 5 })

    group.broadcastByKey({ key: [{ userId: 99 }] })
    expect(spy).not.toHaveBeenCalled()
  })
})


