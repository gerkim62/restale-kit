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

  it('handles state change listeners, custom onError handler, and unsubscribe errors', async () => {
    const stateListeners: Array<(state: { reason?: unknown }) => void> = []
    const mockUnsubscribe = vi.fn().mockRejectedValue(new Error('Unsubscribe failed'))
    const mockOff = vi.fn()

    const channel: AblyChannel = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: mockUnsubscribe,
      on: vi.fn((event, cb) => {
        stateListeners.push(cb)
      }),
      off: mockOff,
    }

    const client: AblyClient = {
      channels: { get: () => channel },
    }

    const adapter = ablyPubSubAdapter(client)
    const errorHandler = vi.fn()
    if (adapter.onError) {
      adapter.onError(errorHandler)
    }

    const unsub = await adapter.subscribe('channel-1', vi.fn())
    expect(channel.on).toHaveBeenCalledWith('failed', expect.any(Function))
    expect(channel.on).toHaveBeenCalledWith('update', expect.any(Function))

    // Trigger state change error
    const reasonErr = new Error('Ably state error')
    stateListeners[0]({ reason: reasonErr })
    expect(errorHandler).toHaveBeenCalledWith(reasonErr)

    // Unsubscribe throws error
    await expect(unsub()).rejects.toThrow('Unsubscribe failed')
    expect(mockOff).toHaveBeenCalledWith('failed', expect.any(Function))
    expect(mockOff).toHaveBeenCalledWith('update', expect.any(Function))
    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error))
  })

  it('handles client connection error events, legacy native echo signals, and error handler callback throws', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const connListeners: Record<string, (err: unknown) => void> = {}

    const { client, channelListeners } = createMockAblyClient(false)
    ;(client as any).connection = {
      on: (event: string, cb: (err: unknown) => void) => {
        connListeners[event] = cb
      },
    }

    const adapter = ablyPubSubAdapter(client, { useNativeEchoSuppression: true })
    const throwingCallback = vi.fn().mockImplementation(() => {
      throw new Error('Listener error')
    })

    await adapter.subscribe('channel-1', throwingCallback)

    // Connection error event -> triggers default console.warn
    connListeners['error']?.(new Error('Connection error'))
    expect(consoleSpy).toHaveBeenCalledWith(
      '[WARN][ablyPubSubAdapter] Unhandled ably connection/channel error:',
      expect.any(Error)
    )

    // Legacy signal payload unwrapping with throwing listener
    const listener = channelListeners[0]
    listener({ data: { key: ['legacy-signal'] } })

    consoleSpy.mockRestore()
  })

  it('unsubscribes cleanly removing stateListeners when channel.off is available', async () => {
    const mockOff = vi.fn()
    const channel: AblyChannel = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: mockOff,
    }
    const client: AblyClient = {
      channels: { get: () => channel },
    }

    const adapter = ablyPubSubAdapter(client)
    const unsub = await adapter.subscribe('channel-clean', vi.fn())

    await unsub()

    expect(mockOff).toHaveBeenCalledWith('failed', expect.any(Function))
    expect(mockOff).toHaveBeenCalledWith('update', expect.any(Function))
    expect(channel.unsubscribe).toHaveBeenCalled()
  })
})


