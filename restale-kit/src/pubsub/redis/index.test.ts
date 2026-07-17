import { describe, it, expect, vi } from 'vitest'
import { redisPubSubAdapter, type RedisClient } from './index.js'
import { wrapEnvelope } from '@/pubsub/core/envelope.js'


function createMockRedisClient(): { client: RedisClient; listeners: Record<string, (...args: any[]) => void> } {
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

describe('redisPubSubAdapter', () => {
  it('publishes wrapped envelope over Redis client', async () => {
    const { client } = createMockRedisClient()
    const adapter = redisPubSubAdapter(client, { encrypt: false })

    await adapter.publish('topic-1', { kind: 'signal', data: { key: ['todos'] } })

    expect(client.publish).toHaveBeenCalledWith(
      'topic-1',
      expect.stringContaining('"kind":"signal"')
    )
  })

  it('subscribes and dispatches unwrapped remote messages', async () => {
    const { client, listeners } = createMockRedisClient()
    const adapter = redisPubSubAdapter(client, { encrypt: false })
    const callback = vi.fn()

    await adapter.subscribe('topic-1', callback)

    // Simulate incoming message event from redis subscriber
    const remoteEnvelope = JSON.stringify({
      origin: 'remote-instance',
      payload: { kind: 'signal', data: { key: ['users'] } },
    })

    listeners['message']?.('topic-1', remoteEnvelope)

    expect(callback).toHaveBeenCalledWith({ kind: 'signal', data: { key: ['users'] } })
  })

  it('suppresses self-echoed messages', async () => {
    const { client, listeners } = createMockRedisClient()
    const adapter = redisPubSubAdapter(client, { encrypt: false })
    const callback = vi.fn()

    await adapter.subscribe('topic-1', callback)

    // Capture published payload to get local origin ID
    await adapter.publish('topic-1', { kind: 'signal', data: { key: ['self'] } })
    const publishedPayload = (client.publish as any).mock.calls[0][1]

    listeners['message']?.('topic-1', publishedPayload)

    expect(callback).not.toHaveBeenCalled()
  })

  it('unsubscribes and cleans up channel callbacks', async () => {
    const { client } = createMockRedisClient()
    const adapter = redisPubSubAdapter(client, { encrypt: false })

    const unsub = await adapter.subscribe('topic-1', vi.fn())
    await unsub()

    expect(client.unsubscribe).toHaveBeenCalledWith('topic-1')
  })

  it('handles default warn fallback, onError handler, message parse errors, and unsubscribe errors', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, listeners } = createMockRedisClient()

    const adapter = redisPubSubAdapter(client, { encrypt: false })

    // Trigger subscriber client error event -> default warn
    listeners['error']?.(new Error('Redis connection error'))
    expect(consoleSpy).toHaveBeenCalledWith(
      '[WARN][redisPubSubAdapter] Unhandled redis subscription client error:',
      expect.any(Error)
    )

    // Set custom error handler
    const errorHandler = vi.fn()
    adapter.onError?.(errorHandler)

    listeners['error']?.(new Error('Custom error'))
    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error))

    // Message handler throws when callback throws
    const throwingCallback = vi.fn().mockImplementation(() => {
      throw new Error('OnMessage error')
    })
    await adapter.subscribe('topic-1', throwingCallback)

    const remoteEnvelope = JSON.stringify({
      origin: 'remote-id',
      payload: { kind: 'signal', data: { key: ['err-test'] } },
    })
    listeners['message']?.('topic-1', remoteEnvelope)
    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error))

    // Unsubscribe error
    vi.mocked(client.unsubscribe).mockRejectedValueOnce(new Error('Redis unsubscribe failed'))
    const unsub = await adapter.subscribe('topic-2', vi.fn())
    await expect(unsub()).rejects.toThrow('Redis unsubscribe failed')
    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error))

    consoleSpy.mockRestore()
  })

  it('ignores message received on channel without registered subscriber', () => {
    const { client, listeners } = createMockRedisClient()
    const adapter = redisPubSubAdapter(client, { encrypt: false })

    // Fire message for 'unregistered-topic'
    expect(() => {
      listeners['message']?.('unregistered-topic', JSON.stringify({ origin: 'other', payload: { kind: 'signal', data: { key: ['x'] } } }))
    }).not.toThrow()
  })

  const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  const wrongKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

  it('encrypts published envelope payload when encryptionKey is configured', async () => {
    const { client } = createMockRedisClient()
    const adapter = redisPubSubAdapter(client, { encryptionKey: validKey })

    await adapter.publish('topic-encrypted', { kind: 'signal', data: { key: ['todos'] } })

    expect(client.publish).toHaveBeenCalledWith(
      'topic-encrypted',
      expect.any(String)
    )

    const publishedPayloadStr = (client.publish as any).mock.calls[0][1]
    const parsed = JSON.parse(publishedPayloadStr)
    expect(parsed.origin).toBeDefined()
    expect(typeof parsed.payload).toBe('string')
    expect(parsed.payload).not.toContain('todos') // Encrypted, not plaintext
    expect(parsed.payload.split(':').length).toBe(3) // iv:authTag:ciphertext
  })

  it('decrypts encrypted payload correctly', async () => {
    const { client, listeners } = createMockRedisClient()
    const adapter = redisPubSubAdapter(client, { encryptionKey: validKey })
    const callback = vi.fn()

    await adapter.subscribe('topic-encrypted', callback)

    const remoteEnvelope = wrapEnvelope('remote-origin', { kind: 'signal', data: { key: ['todos'] } }, validKey, 'topic-encrypted')

    listeners['message']?.('topic-encrypted', JSON.stringify(remoteEnvelope))
    expect(callback).toHaveBeenCalledWith({ kind: 'signal', data: { key: ['todos'] } })
  })

  it('throttles decryption failure warnings and drops messages on key mismatch', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, listeners } = createMockRedisClient()
    const adapter = redisPubSubAdapter(client, { encryptionKey: validKey })
    const callback = vi.fn()

    await adapter.subscribe('topic-encrypted', callback)

    // Construct envelope using wrong key
    const remoteEnvelope = wrapEnvelope('remote-origin', { kind: 'signal', data: { key: ['todos'] } }, wrongKey, 'topic-encrypted')

    // Simulate receiving message with wrong key (causes DecryptionError)
    listeners['message']?.('topic-encrypted', JSON.stringify(remoteEnvelope))

    // Callback should not be called (message dropped)
    expect(callback).not.toHaveBeenCalled()

    // Warning should have been logged
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Decryption failed')

    // Simulate consecutive failure immediately
    listeners['message']?.('topic-encrypted', JSON.stringify(remoteEnvelope))
    // Warning should be throttled (still called only 1 time)
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1)

    consoleWarnSpy.mockRestore()
  })
})


