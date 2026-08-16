import { describe, it, expect, vi } from 'vitest'
import { redisPubSubAdapter, type RedisClient } from '@/pubsub/redis/index.js'
import { ablyPubSubAdapter, type AblyClient, type AblyChannel } from '@/pubsub/ably/index.js'
import { pusherPubSubAdapter, type PusherClient } from '@/pubsub/pusher/index.js'
import type { PubSubMessage, UniversalSignal } from '@/types/protocol.js'

function createMockRedisClient(): {
  client: RedisClient
  listeners: Record<string, (...args: any[]) => void>
} {
  const listeners: Record<string, (...args: any[]) => void> = {}
  const client: RedisClient = {
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue('OK'),
    unsubscribe: vi.fn().mockResolvedValue('OK'),
    duplicate: () => client,
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      listeners[event] = listener
    }),
  }
  return { client, listeners }
}

function createMockAblyClient(): {
  client: AblyClient
  channel: AblyChannel
  channelListeners: Array<(msg: { data: unknown }) => void>
} {
  const channelListeners: Array<(msg: { data: unknown }) => void> = []
  const channel: AblyChannel = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((listener) => {
      channelListeners.push(listener)
    }),
    unsubscribe: vi.fn(),
  }
  const client: AblyClient = {
    options: { echoMessages: true },
    channels: {
      get: () => channel,
    },
  }
  return { client, channel, channelListeners }
}

function createMockPusherClient(): {
  client: PusherClient
  events: Array<{ channel: string; name: string; data: string | object }>
} {
  const events: Array<{ channel: string; name: string; data: string | object }> = []
  const client: PusherClient = {
    trigger: vi.fn().mockResolvedValue({ status: 200 }),
    webhook: vi.fn().mockReturnValue({
      isValid: () => true,
      getEvents: () => events,
    }),
  }
  return { client, events }
}

describe('Pub/sub envelope round trip (plaintext & encrypted)', () => {
  const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

  const batchSignal: UniversalSignal[] = [
    { key: ['todos', 'list'], exact: true },
    { key: ['users', 42], inlineData: { name: 'Bob', role: 'admin' }, markStale: true },
  ]
  const message: PubSubMessage = { kind: 'signal', data: batchSignal }

  // ──────────────── Redis PubSub Adapter ────────────────
  describe('Redis PubSub Adapter', () => {
    it('round-trips plaintext payload when encryptionKey is omitted', async () => {
      const pub = createMockRedisClient()
      const sub = createMockRedisClient()

      const pubAdapter = redisPubSubAdapter(pub.client, { encrypt: false })
      const subAdapter = redisPubSubAdapter(sub.client, { encrypt: false })

      const callback = vi.fn()
      await subAdapter.subscribe('todos-topic', callback)

      await pubAdapter.publish('todos-topic', message)

      expect(pub.client.publish).toHaveBeenCalledTimes(1)
      const publishedPayload = (pub.client.publish as any).mock.calls[0][1] as string

      // On-wire verification: plaintext JSON contains readable strings
      expect(typeof publishedPayload).toBe('string')
      expect(publishedPayload).toContain('"kind":"signal"')
      expect(publishedPayload).toContain('todos')
      expect(publishedPayload).toContain('Bob')

      // Deliver message to subscriber
      sub.listeners['message']?.('todos-topic', publishedPayload)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(message)
    })

    it('round-trips ciphertext payload when encryptionKey is configured', async () => {
      const pub = createMockRedisClient()
      const sub = createMockRedisClient()

      const pubAdapter = redisPubSubAdapter(pub.client, { encryptionKey })
      const subAdapter = redisPubSubAdapter(sub.client, { encryptionKey })

      const callback = vi.fn()
      await subAdapter.subscribe('todos-topic', callback)

      await pubAdapter.publish('todos-topic', message)

      expect(pub.client.publish).toHaveBeenCalledTimes(1)
      const publishedPayload = (pub.client.publish as any).mock.calls[0][1] as string

      // On-wire verification: payload is an encrypted envelope string (iv:authTag:ciphertext)
      const envelope = JSON.parse(publishedPayload)
      expect(envelope.origin).toBeDefined()
      expect(typeof envelope.payload).toBe('string')
      expect(envelope.payload.split(':')).toHaveLength(3)
      expect(envelope.payload).not.toContain('todos')
      expect(envelope.payload).not.toContain('Bob')

      // Deliver message to subscriber
      sub.listeners['message']?.('todos-topic', publishedPayload)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(message)
    })
  })

  // ──────────────── Ably PubSub Adapter ────────────────
  describe('Ably PubSub Adapter', () => {
    it('round-trips plaintext payload when encryptionKey is omitted', async () => {
      const pub = createMockAblyClient()
      const sub = createMockAblyClient()

      const pubAdapter = ablyPubSubAdapter(pub.client, { encrypt: false })
      const subAdapter = ablyPubSubAdapter(sub.client, { encrypt: false })

      const callback = vi.fn()
      await subAdapter.subscribe('todos-channel', callback)

      await pubAdapter.publish('todos-channel', message)

      expect(pub.channel.publish).toHaveBeenCalledTimes(1)
      const publishedData = (pub.channel.publish as any).mock.calls[0][1]

      // On-wire verification: payload is unencrypted object
      expect(publishedData.origin).toBeDefined()
      expect(publishedData.payload).toEqual(message)

      // Deliver message to subscriber
      const listener = sub.channelListeners[0]
      expect(listener).toBeDefined()
      listener({ data: publishedData })

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(message)
    })

    it('round-trips ciphertext payload when encryptionKey is configured', async () => {
      const pub = createMockAblyClient()
      const sub = createMockAblyClient()

      const pubAdapter = ablyPubSubAdapter(pub.client, { encryptionKey })
      const subAdapter = ablyPubSubAdapter(sub.client, { encryptionKey })

      const callback = vi.fn()
      await subAdapter.subscribe('todos-channel', callback)

      await pubAdapter.publish('todos-channel', message)

      expect(pub.channel.publish).toHaveBeenCalledTimes(1)
      const publishedData = (pub.channel.publish as any).mock.calls[0][1]

      // On-wire verification: payload is ciphertext string
      expect(publishedData.origin).toBeDefined()
      expect(typeof publishedData.payload).toBe('string')
      expect(publishedData.payload.split(':')).toHaveLength(3)
      expect(publishedData.payload).not.toContain('todos')
      expect(publishedData.payload).not.toContain('Bob')

      // Deliver message to subscriber
      const listener = sub.channelListeners[0]
      expect(listener).toBeDefined()
      listener({ data: publishedData })

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(message)
    })
  })

  // ──────────────── Pusher PubSub Adapter ────────────────
  describe('Pusher PubSub Adapter', () => {
    it('round-trips plaintext payload when encryptionKey is omitted', async () => {
      const pub = createMockPusherClient()
      const sub = createMockPusherClient()

      const pubAdapter = pusherPubSubAdapter(pub.client, { encrypt: false })
      const subAdapter = pusherPubSubAdapter(sub.client, { encrypt: false })

      const callback = vi.fn()
      await subAdapter.subscribe('todos-pusher', callback)

      await pubAdapter.publish('todos-pusher', message)

      expect(pub.client.trigger).toHaveBeenCalledTimes(1)
      const publishedEnvelope = (pub.client.trigger as any).mock.calls[0][2]

      // On-wire verification: payload is unencrypted object
      expect(publishedEnvelope.origin).toBeDefined()
      expect(publishedEnvelope.payload).toEqual(message)

      // Deliver via webhook
      sub.events.push({
        channel: 'todos-pusher',
        name: 'invalidate',
        data: publishedEnvelope,
      })
      const handled = subAdapter.handleWebhook('raw-body', {})
      expect(handled).toBe(true)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(message)
    })

    it('round-trips ciphertext payload when encryptionKey is configured', async () => {
      const pub = createMockPusherClient()
      const sub = createMockPusherClient()

      const pubAdapter = pusherPubSubAdapter(pub.client, { encryptionKey })
      const subAdapter = pusherPubSubAdapter(sub.client, { encryptionKey })

      const callback = vi.fn()
      await subAdapter.subscribe('todos-pusher', callback)

      await pubAdapter.publish('todos-pusher', message)

      expect(pub.client.trigger).toHaveBeenCalledTimes(1)
      const publishedEnvelope = (pub.client.trigger as any).mock.calls[0][2]

      // On-wire verification: payload is ciphertext string
      expect(publishedEnvelope.origin).toBeDefined()
      expect(typeof publishedEnvelope.payload).toBe('string')
      expect(publishedEnvelope.payload.split(':')).toHaveLength(3)
      expect(publishedEnvelope.payload).not.toContain('todos')
      expect(publishedEnvelope.payload).not.toContain('Bob')

      // Deliver via webhook
      sub.events.push({
        channel: 'todos-pusher',
        name: 'invalidate',
        data: publishedEnvelope,
      })
      const handled = subAdapter.handleWebhook('raw-body', {})
      expect(handled).toBe(true)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(message)
    })
  })
})
