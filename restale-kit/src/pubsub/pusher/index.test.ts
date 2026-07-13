import { describe, it, expect, vi } from 'vitest'
import { pusherPubSubAdapter, type PusherClient, type PusherWebhook } from './index.js'

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
    const adapter = pusherPubSubAdapter(client)

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
    const adapter = pusherPubSubAdapter(client)

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
    const adapter = pusherPubSubAdapter(client)

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
    const adapter = pusherPubSubAdapter(client)
    const callback = vi.fn()

    await adapter.subscribe('my-channel', callback)

    const success = adapter.handleWebhook('valid-body', { 'x-pusher-signature': 'sig' })

    expect(success).toBe(true)
    expect(callback).toHaveBeenCalledWith({ kind: 'signal', data: { key: ['posts'] } })
  })
})
