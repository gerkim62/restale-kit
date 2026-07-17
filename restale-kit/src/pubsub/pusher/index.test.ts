import { describe, it, expect, vi } from 'vitest'
import { pusherPubSubAdapter, type PusherClient, type PusherWebhook } from './index.js'
import { wrapEnvelope } from '@/pubsub/core/envelope.js'


function createMockPusherClient(validWebhook = true, events: any[] = []): PusherClient {
  return {
    trigger: vi.fn().mockResolvedValue({ status: 200 }),
    webhook: vi.fn().mockReturnValue({
      isValid: () => validWebhook,
      getEvents: () => events,
    }),
  }
}

describe('pusherPubSubAdapter', () => {
  it('triggers pusher invalidate event on publish', async () => {
    const client = createMockPusherClient()
    const adapter = pusherPubSubAdapter(client, { encrypt: false })

    await adapter.publish('my-channel', { kind: 'signal', data: { key: ['todos'] } })

    expect(client.trigger).toHaveBeenCalledWith(
      'my-channel',
      'invalidate',
      expect.objectContaining({
        origin: expect.any(String),
        payload: { kind: 'signal', data: { key: ['todos'] } },
      })
    )
  })

  it('triggers pusher control event on publish control payload', async () => {
    const client = createMockPusherClient()
    const adapter = pusherPubSubAdapter(client, { encrypt: false })

    await adapter.publish('my-channel', { kind: 'control', data: { userId: 42 } })

    expect(client.trigger).toHaveBeenCalledWith(
      'my-channel',
      'control',
      expect.objectContaining({
        origin: expect.any(String),
        payload: { kind: 'control', data: { userId: 42 } },
      })
    )
  })

  it('returns false when handleWebhook signature validation fails', () => {
    const client = createMockPusherClient(false)
    const adapter = pusherPubSubAdapter(client, { encrypt: false })

    const result = adapter.handleWebhook('raw-body', {})
    expect(result).toBe(false)
  })

  it('dispatches unwrapped webhook events to subscribed channel callback', async () => {
    const remoteEnvelope = {
      origin: 'remote-pusher-id',
      payload: { kind: 'signal', data: { key: ['posts'] } },
    }
    const events = [{ channel: 'my-channel', name: 'invalidate', data: remoteEnvelope }]

    const client = createMockPusherClient(true, events)
    const adapter = pusherPubSubAdapter(client, { encrypt: false })
    const callback = vi.fn()

    await adapter.subscribe('my-channel', callback)

    const success = adapter.handleWebhook('valid-body', { 'x-pusher-signature': 'sig' })

    expect(success).toBe(true)
    expect(callback).toHaveBeenCalledWith({ kind: 'signal', data: { key: ['posts'] } })
  })

  it('handles default warn handler, onError registration, unsubscribe, and webhook processing errors', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const validEnvelopeEvents = [
      {
        channel: 'my-channel',
        name: 'invalidate',
        data: {
          origin: 'remote-id',
          payload: { kind: 'signal', data: { key: ['todos'] } },
        },
      },
    ]

    const client = createMockPusherClient(true, validEnvelopeEvents)
    const adapter = pusherPubSubAdapter(client, { encrypt: false })

    // Subscribe with callback that throws an error
    const throwingCallback = vi.fn().mockImplementation(() => {
      throw new Error('Callback failed')
    })
    const unsub = await adapter.subscribe('my-channel', throwingCallback)

    // Test default error handler warning when callback throws
    adapter.handleWebhook('body', {})
    expect(consoleSpy).toHaveBeenCalledWith(
      '[WARN][pusherPubSubAdapter] Unhandled pusher error:',
      expect.any(Error)
    )

    // Unsubscribe test
    await unsub()

    // Test custom onError handler
    const customErrorHandler = vi.fn()
    adapter.onError?.(customErrorHandler)

    // Trigger webhook top level throw
    vi.mocked(client.webhook).mockImplementationOnce(() => {
      throw new Error('Webhook processing failed')
    })

    const res = adapter.handleWebhook('bad-body', {})
    expect(res).toBe(false)
    expect(customErrorHandler).toHaveBeenCalledWith(expect.any(Error))

    consoleSpy.mockRestore()
  })

  it('dispatches control events received via pusher webhook', async () => {
    const controlEnvelope = {
      origin: 'remote-pusher-id',
      payload: { kind: 'control', data: { userId: 99 } },
    }
    const events = [{ channel: 'my-channel', name: 'control', data: controlEnvelope }]

    const client = createMockPusherClient(true, events)
    const adapter = pusherPubSubAdapter(client, { encrypt: false })
    const callback = vi.fn()

    await adapter.subscribe('my-channel', callback)

    const success = adapter.handleWebhook('valid-body', {})

    expect(success).toBe(true)
    expect(callback).toHaveBeenCalledWith({ kind: 'control', data: { userId: 99 } })
  })

  it('ignores webhooks with unrecognized event names', async () => {
    const events = [{ channel: 'my-channel', name: 'client-event', data: {} }]
    const client = createMockPusherClient(true, events)
    const adapter = pusherPubSubAdapter(client, { encrypt: false })
    const callback = vi.fn()

    await adapter.subscribe('my-channel', callback)
    const success = adapter.handleWebhook('body', {})

    expect(success).toBe(true)
    expect(callback).not.toHaveBeenCalled()
  })

  it('handles webhooks for channels without active subscriber callbacks', () => {
    const events = [
      {
        channel: 'unregistered-channel',
        name: 'invalidate',
        data: { origin: 'other', payload: { kind: 'signal', data: { key: ['x'] } } },
      },
    ]
    const client = createMockPusherClient(true, events)
    const adapter = pusherPubSubAdapter(client, { encrypt: false })

    const success = adapter.handleWebhook('valid-body', {})
    expect(success).toBe(true)
  })

  const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  const wrongKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

  it('encrypts published envelope payload when encryptionKey is configured', async () => {
    const client = createMockPusherClient()
    const adapter = pusherPubSubAdapter(client, { encryptionKey: validKey })

    await adapter.publish('my-channel', { kind: 'signal', data: { key: ['todos'] } })

    expect(client.trigger).toHaveBeenCalledWith(
      'my-channel',
      'invalidate',
      expect.objectContaining({
        origin: expect.any(String),
        payload: expect.any(String),
      })
    )

    const publishedEnvelope = (client.trigger as any).mock.calls[0][2]
    expect(publishedEnvelope.payload).not.toContain('todos')
    expect(publishedEnvelope.payload.split(':').length).toBe(3)
  })

  it('decrypts encrypted webhook payload correctly', async () => {
    const message = { kind: 'signal' as const, data: { key: ['posts'] } }
    const encryptedEnvelope = wrapEnvelope('remote-pusher-id', message, validKey, 'my-channel')
    const events = [{ channel: 'my-channel', name: 'invalidate', data: encryptedEnvelope }]

    const client = createMockPusherClient(true, events)
    const adapter = pusherPubSubAdapter(client, { encryptionKey: validKey })
    const callback = vi.fn()

    await adapter.subscribe('my-channel', callback)

    const success = adapter.handleWebhook('valid-body', { 'x-pusher-signature': 'sig' })

    expect(success).toBe(true)
    expect(callback).toHaveBeenCalledWith(message)
  })

  it('throttles decryption failure warnings and drops messages on key mismatch', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const message = { kind: 'signal' as const, data: { key: ['posts'] } }
    const encryptedEnvelope = wrapEnvelope('remote-pusher-id', message, wrongKey, 'my-channel')
    const events = [{ channel: 'my-channel', name: 'invalidate', data: encryptedEnvelope }]

    const client = createMockPusherClient(true, events)
    const adapter = pusherPubSubAdapter(client, { encryptionKey: validKey })
    const callback = vi.fn()

    await adapter.subscribe('my-channel', callback)

    const success1 = adapter.handleWebhook('valid-body', {})
    expect(success1).toBe(true)
    expect(callback).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Decryption failed')

    const success2 = adapter.handleWebhook('valid-body', {})
    expect(success2).toBe(true)
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1)

    consoleWarnSpy.mockRestore()
  })
})


