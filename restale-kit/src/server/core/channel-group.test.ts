import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SSEChannelGroup } from './channel-group.js'
import { createSSEChannel } from './channel.js'
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
    ch1.close()

    group.register(ch1, { userId: 1 })
    expect(group.size).toBe(1)

    group.broadcastToAll({ key: ['test'] })
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
})
