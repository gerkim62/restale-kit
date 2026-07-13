import { describe, it, expect, vi } from 'vitest'
import { ablyPubSubAdapter, type AblyClient, type AblyChannel } from './index.js'

function createMockAblyClient(echoMessages = true): {
  client: AblyClient
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
    options: { echoMessages },
    channels: {
      get: () => channel,
    },
  }

  return { client, channelListeners }
}

describe('ablyPubSubAdapter', () => {
  it('throws error when useNativeEchoSuppression is enabled but echoMessages is not false', () => {
    const { client } = createMockAblyClient(true)
    expect(() => ablyPubSubAdapter(client, { useNativeEchoSuppression: true })).toThrow(
      'echoMessages must be explicitly set to false'
    )
  })

  it('publishes wrapped envelope by default', async () => {
    const { client } = createMockAblyClient()
    const adapter = ablyPubSubAdapter(client)

    await adapter.publish('channel-1', { kind: 'signal', data: { key: ['test'] } })

    const channel = client.channels.get('channel-1')
    expect(channel.publish).toHaveBeenCalledWith(
      'invalidate',
      expect.objectContaining({
        origin: expect.any(String),
        payload: { kind: 'signal', data: { key: ['test'] } },
      })
    )
  })

  it('unwraps and delivers remote messages', async () => {
    const { client, channelListeners } = createMockAblyClient()
    const adapter = ablyPubSubAdapter(client)
    const callback = vi.fn()

    await adapter.subscribe('channel-1', callback)

    const listener = channelListeners[0]
    listener({
      data: {
        origin: 'remote-id',
        payload: { kind: 'signal', data: { key: ['remote-item'] } },
      },
    })

    expect(callback).toHaveBeenCalledWith({ kind: 'signal', data: { key: ['remote-item'] } })
  })

  it('supports native echo suppression when enabled', async () => {
    const { client, channelListeners } = createMockAblyClient(false)
    const adapter = ablyPubSubAdapter(client, { useNativeEchoSuppression: true })
    const callback = vi.fn()

    await adapter.subscribe('channel-1', callback)
    await adapter.publish('channel-1', { kind: 'signal', data: { key: ['native-test'] } })

    const channel = client.channels.get('channel-1')
    expect(channel.publish).toHaveBeenCalledWith('invalidate', {
      kind: 'signal',
      data: { key: ['native-test'] },
    })

    const listener = channelListeners[0]
    listener({ data: { kind: 'signal', data: { key: ['native-test'] } } })

    expect(callback).toHaveBeenCalledWith({ kind: 'signal', data: { key: ['native-test'] } })
  })
})
