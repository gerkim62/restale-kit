import { describe, it, expect, vi } from 'vitest'
import { redisPubSubAdapter, type RedisClient } from './index.js'

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
    const adapter = redisPubSubAdapter(client)

    await adapter.publish('topic-1', { kind: 'signal', data: { key: ['todos'] } })

    expect(client.publish).toHaveBeenCalledWith(
      'topic-1',
      expect.stringContaining('"kind":"signal"')
    )
  })

  it('subscribes and dispatches unwrapped remote messages', async () => {
    const { client, listeners } = createMockRedisClient()
    const adapter = redisPubSubAdapter(client)
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
    const adapter = redisPubSubAdapter(client)
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
    const adapter = redisPubSubAdapter(client)

    const unsub = await adapter.subscribe('topic-1', vi.fn())
    await unsub()

    expect(client.unsubscribe).toHaveBeenCalledWith('topic-1')
  })

  it('handles default warn fallback, onError handler, message parse errors, and unsubscribe errors', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, listeners } = createMockRedisClient()

    const adapter = redisPubSubAdapter(client)

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
})


