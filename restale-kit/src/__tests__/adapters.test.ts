import test from 'node:test'
import assert from 'node:assert'
import { redisPubSubAdapter, type RedisClient } from '@/pubsub/redis/index.js'
import { ablyPubSubAdapter, type AblyClient, type AblyChannel } from '@/pubsub/ably/index.js'
import { pusherPubSubAdapter, type PusherClient, type PusherWebhook } from '@/pubsub/pusher/index.js'

// Mock event emitter for Redis clients implementing RedisClient structurally
class MockRedisClient implements RedisClient {
  listeners: Record<string, Array<(...args: any[]) => void>> = {}
  published: Array<{ topic: string; message: string }> = []
  duplicated = false

  on(event: 'error' | 'message', fn: (...args: any[]) => void): this {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(fn)
    return this
  }

  duplicate(): RedisClient {
    const dup = new MockRedisClient()
    dup.duplicated = true
    return dup
  }

  publish(topic: string, message: string): unknown {
    this.published.push({ topic, message })
    return Promise.resolve(1)
  }

  unsubscribe(_topic: string): unknown {
    return Promise.resolve()
  }

  subscribe(_topic: string): unknown {
    return Promise.resolve()
  }

  emit(event: 'error' | 'message', ...args: unknown[]) {
    const list = this.listeners[event]
    if (list) {
      for (const fn of list) {
        fn(...args)
      }
    }
  }
}

// Mock Ably channel implementing AblyChannel structurally
class MockAblyChannel implements AblyChannel {
  publishedEvents: Array<{ name: string; data: unknown }> = []
  listeners: Record<string, Array<(stateChange: any) => void>> = {}

  publish(name: string, data: unknown): unknown {
    this.publishedEvents.push({ name, data })
    return Promise.resolve()
  }

  subscribe(listener: (message: { data: any }) => void): unknown {
    return Promise.resolve()
  }

  unsubscribe(listener: (message: { data: any }) => void): unknown {
    return Promise.resolve()
  }

  on(event: string, listener: (stateChange: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(listener)
  }

  off(event: string, listener: (stateChange: any) => void): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(l => l !== listener)
    }
  }

  emit(event: string, stateChange: any): void {
    if (this.listeners[event]) {
      for (const l of this.listeners[event]) {
        l(stateChange)
      }
    }
  }
}

// Mock Ably client implementing AblyClient structurally
class MockAblyClient implements AblyClient {
  connection = {
    on: (event: 'error', listener: (err: unknown) => void): unknown => {
      return null
    }
  }

  channels = {
    get: (name: string): AblyChannel => this.channel
  }

  constructor(
    public options: { echoMessages: boolean },
    public channel: MockAblyChannel = new MockAblyChannel()
  ) {}
}

// Mock Pusher webhook implementing PusherWebhook structurally
class MockPusherWebhook implements PusherWebhook {
  constructor(
    private readonly valid: boolean,
    private readonly events: Array<{ channel: string; name: string; data: string | object }>
  ) {}

  isValid(): boolean {
    return this.valid
  }

  getEvents(): Array<{ channel: string; name: string; data: string | object }> {
    return this.events
  }
}

// Mock Pusher client implementing PusherClient structurally
class MockPusherClient implements PusherClient {
  triggered: Array<{ channel: string; event: string; data: unknown }> = []
  valid = false
  events: Array<{ channel: string; name: string; data: string | object }> = []

  trigger(channel: string, event: string, data: unknown): unknown {
    this.triggered.push({ channel, event, data })
    return Promise.resolve({})
  }

  webhook(options: { headers: Record<string, string>; rawBody: string }): PusherWebhook {
    return new MockPusherWebhook(this.valid, this.events)
  }
}

void test('Redis PubSub Adapter', async (t) => {
  await t.test('default duplicate behavior & error delegation', () => {
    const client = new MockRedisClient()
    const adapter = redisPubSubAdapter(client)

    // Verify duplication occurred internally
    assert.ok(adapter)

    // Verify custom onError delegation
    let errorForwarded: unknown = null
    adapter.onError!((err) => {
      errorForwarded = err
    })

    // Setup an explicit subscribeClient to dispatch events and test error routing
    const subClient = new MockRedisClient()
    const adapterWithSub = redisPubSubAdapter(client, { subscribeClient: subClient })
    adapterWithSub.onError!((err) => {
      errorForwarded = err
    })

    subClient.emit('error', new Error('Redis Connection Error'))
    assert.ok(errorForwarded)
    if (errorForwarded instanceof Error) {
      assert.strictEqual(errorForwarded.message, 'Redis Connection Error')
    } else {
      assert.fail('Error is not an instance of Error')
    }
  })

  await t.test('publishing envelopes and self-echo suppression', async () => {
    const publishClient = new MockRedisClient()
    const subscribeClient = new MockRedisClient()
    const adapter = redisPubSubAdapter(publishClient, { subscribeClient })

    let receivedMessage: unknown = null
    await adapter.subscribe('topic-x', (msg) => {
      receivedMessage = msg
    })

    // Publish
    const testSignal = { key: ['todos'] }
    await adapter.publish('topic-x', { kind: 'signal', data: testSignal })

    // Verify published message is a JSON string of the envelope
    assert.strictEqual(publishClient.published.length, 1)
    const { topic, message } = publishClient.published[0]
    assert.strictEqual(topic, 'topic-x')

    const envelope = JSON.parse(message) as Record<string, unknown>
    assert.ok(envelope['origin'])
    assert.deepStrictEqual(envelope['payload'], { kind: 'signal', data: testSignal })

    // Simulate receiving message published from *our* instance (self-echo)
    subscribeClient.emit('message', 'topic-x', message)
    assert.strictEqual(receivedMessage, null) // Suppressed!

    // Simulate receiving message published from *another* instance
    const foreignEnvelope = {
      origin: 'another-instance-id',
      payload: { kind: 'signal', data: { key: ['todos', 'other'] } }
    }
    subscribeClient.emit('message', 'topic-x', JSON.stringify(foreignEnvelope))
    assert.deepStrictEqual(receivedMessage, { kind: 'signal', data: { key: ['todos', 'other'] } }) // Delivered!
  })
})

void test('Ably PubSub Adapter', async (t) => {
  await t.test('validation of useNativeEchoSuppression options', () => {
    // If native echo is true, but client echo is not false -> should throw
    const invalidClient = new MockAblyClient({ echoMessages: true })
    assert.throws(() => {
      ablyPubSubAdapter(invalidClient, { useNativeEchoSuppression: true })
    }, /echoMessages must be explicitly set to false/)

    // If client echo is false -> should succeed
    const validClient = new MockAblyClient({ echoMessages: false })
    const adapter = ablyPubSubAdapter(validClient, { useNativeEchoSuppression: true })
    assert.ok(adapter)
  })

  await t.test('publishing with envelope vs native suppression', async () => {
    const defaultChannel = new MockAblyChannel()
    const defaultClient = new MockAblyClient({ echoMessages: true }, defaultChannel)

    // Default: uses envelope
    const defaultAdapter = ablyPubSubAdapter(defaultClient)
    await defaultAdapter.publish('topic-y', { kind: 'signal', data: { key: ['1'] } })
    assert.strictEqual(defaultChannel.publishedEvents.length, 1)
    const data = defaultChannel.publishedEvents[0].data as Record<string, unknown>
    assert.ok(data['origin']) // Envelope present

    // Native: raw payload
    const nativeChannel = new MockAblyChannel()
    const nativeClient = new MockAblyClient({ echoMessages: false }, nativeChannel)
    const nativeAdapter = ablyPubSubAdapter(nativeClient, { useNativeEchoSuppression: true })
    await nativeAdapter.publish('topic-y', { kind: 'signal', data: { key: ['1'] } })
    assert.strictEqual(nativeChannel.publishedEvents.length, 1)
    assert.deepStrictEqual(nativeChannel.publishedEvents[0].data, { kind: 'signal', data: { key: ['1'] } }) // Raw payload
  })

  await t.test('routing of channel failed/update errors and off cleanup', async () => {
    const channel = new MockAblyChannel()
    const client = new MockAblyClient({ echoMessages: true }, channel)
    const adapter = ablyPubSubAdapter(client)

    let errorReceived: unknown = null
    adapter.onError!((err) => {
      errorReceived = err
    })

    const unsub = await adapter.subscribe('topic-err', () => {})

    // 1. Emit a 'failed' event
    channel.emit('failed', { reason: new Error('Ably Channel Attachment Failed') })
    assert.ok(errorReceived)
    assert.strictEqual((errorReceived as Error).message, 'Ably Channel Attachment Failed')

    // Reset
    errorReceived = null

    // 2. Emit an 'update' event with error
    channel.emit('update', { reason: new Error('Ably Channel Update Error') })
    assert.ok(errorReceived)
    assert.strictEqual((errorReceived as Error).message, 'Ably Channel Update Error')

    // Reset
    errorReceived = null

    // 3. Unsubscribe and check listener cleanup
    await unsub()
    channel.emit('failed', { reason: new Error('Should not be routed') })
    assert.strictEqual(errorReceived, null)
  })
})

void test('Pusher Webhook PubSub Adapter', async (t) => {
  await t.test('handleWebhook signature check and routing', async () => {
    const mockPusherServer = new MockPusherClient()
    const adapter = pusherPubSubAdapter(mockPusherServer)

    let receivedMsg: unknown = null
    await adapter.subscribe('topic-p', (msg) => {
      receivedMsg = msg
    })

    // 1. Invalid webhook signature
    mockPusherServer.valid = false
    const ok1 = adapter.handleWebhook('invalid-body', { 'x-pusher-signature': 'bad' })
    assert.strictEqual(ok1, false)
    assert.strictEqual(receivedMsg, null)

    // 2. Valid webhook signature, foreign origin
    mockPusherServer.valid = true
    mockPusherServer.events = [
      {
        channel: 'topic-p',
        name: 'invalidate',
        data: JSON.stringify({
          origin: 'some-other-instance',
          payload: { kind: 'signal', data: { key: ['data'] } }
        })
      }
    ]

    const ok2 = adapter.handleWebhook('body', { 'x-pusher-signature': 'good' })
    assert.strictEqual(ok2, true)
    assert.deepStrictEqual(receivedMsg, { kind: 'signal', data: { key: ['data'] } })

    // 3. Valid webhook signature, self-echo
    receivedMsg = null
    // Grab the origin from a published event
    await adapter.publish('topic-p', { kind: 'signal', data: { key: ['data'] } })
    assert.strictEqual(mockPusherServer.triggered.length, 1)
    const selfEnvelope = mockPusherServer.triggered[0].data as Record<string, unknown>
    const selfOrigin = selfEnvelope['origin'] as string

    mockPusherServer.events = [
      {
        channel: 'topic-p',
        name: 'invalidate',
        data: JSON.stringify({
          origin: selfOrigin,
          payload: { kind: 'signal', data: { key: ['data'] } }
        })
      }
    ]

    const ok3 = adapter.handleWebhook('body2', { 'x-pusher-signature': 'good' })
    assert.strictEqual(ok3, true)
    assert.strictEqual(receivedMsg, null) // Suppressed!
  })
})
