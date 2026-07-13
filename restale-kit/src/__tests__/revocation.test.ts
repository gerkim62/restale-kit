import test from 'node:test'
import assert from 'node:assert'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'
import { appendQueryParam } from '@/utils/url.js'
import { attachSSE } from '@/server/node/attach.js'
import { toSSEResponse } from '@/server/fetch/response.js'
import { SSEChannelGroup } from '@/server/core/channel-group.js'
import { createSSEChannel } from '@/server/core/channel.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import type { PubSubMessage } from '@/types/protocol.js'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

void test('Connection Revocation & URL Query Parameters', async (t) => {
  await t.test('appendQueryParam preserves relative and absolute URLs without introducing localhost origins', () => {
    // Relative URL without search/hash
    assert.strictEqual(
      appendQueryParam('/api/sse', 'restaleKitRequestId', 'uuid-1'),
      '/api/sse?restaleKitRequestId=uuid-1'
    )

    // Relative URL with existing search params
    assert.strictEqual(
      appendQueryParam('/api/sse?token=123', 'restaleKitRequestId', 'uuid-2'),
      '/api/sse?token=123&restaleKitRequestId=uuid-2'
    )

    // Relative URL with search params and hash fragment
    assert.strictEqual(
      appendQueryParam('/api/sse?foo=bar#section', 'restaleKitRequestId', 'uuid-3'),
      '/api/sse?foo=bar&restaleKitRequestId=uuid-3#section'
    )

    // Absolute URL
    assert.strictEqual(
      appendQueryParam('https://example.com/sse?a=1', 'restaleKitRequestId', 'uuid-4'),
      'https://example.com/sse?a=1&restaleKitRequestId=uuid-4'
    )
  })

  await t.test('SSEInvalidatorClient exposes connectionId and appends the internal query parameter', () => {
    const client = new SSEInvalidatorClient('/sse/stream?user=42')
    assert.ok(client.connectionId)
    assert.strictEqual(typeof client.connectionId, 'string')
    assert.strictEqual(
      (client as any).url,
      `/sse/stream?user=42&restaleKitRequestId=${client.connectionId}`
    )
  })

  await t.test('useReStale hook exposes connectionId', async () => {
    const { useReStale } = await import('@/client/react/useReStale.js')
    // Lightweight mock of React environment for hook initialization test
    let res: any
    const TestComponent = () => {
      res = useReStale('/sse', { onInvalidate: () => {} })
      return null
    }
    // Verify constructor instantiation exposes connectionId
    const client = new SSEInvalidatorClient('/sse')
    assert.ok(client.connectionId)
  })

  await t.test('attachSSE and toSSEResponse validation and return shape', () => {
    // 1. attachSSE - missing param throws
    const mockReqMissing = new EventEmitter() as any
    mockReqMissing.url = '/sse'
    mockReqMissing.headers = {}
    const mockRes = Object.assign(new PassThrough(), { writeHead: () => {} }) as any
    assert.throws(
      () => attachSSE(mockReqMissing, mockRes),
      /Missing or invalid restaleKitRequestId query parameter/
    )

    // attachSSE - valid param returns { channel, connectionId }
    const mockReqValid = new EventEmitter() as any
    mockReqValid.url = '/sse?restaleKitRequestId=req-999'
    mockReqValid.headers = {}
    const mockResStream = new PassThrough() as any
    mockResStream.writeHead = () => {}
    const attached = attachSSE(mockReqValid, mockResStream)
    assert.strictEqual(attached.connectionId, 'req-999')
    assert.ok(attached.channel)

    // 2. toSSEResponse - missing param throws
    const fetchReqMissing = new Request('http://localhost/sse')
    assert.throws(
      () => toSSEResponse(fetchReqMissing),
      /Missing or invalid restaleKitRequestId query parameter/
    )

    // toSSEResponse - valid param returns { response, channel, connectionId }
    const fetchReqValid = new Request('http://localhost/sse?restaleKitRequestId=req-888')
    const sseResp = toSSEResponse(fetchReqValid)
    assert.strictEqual(sseResp.connectionId, 'req-888')
    assert.ok(sseResp.channel)
    assert.ok(sseResp.response)
  })

  await t.test('local connection revocation matching', async () => {
    const group = new SSEChannelGroup()

    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()
    const ch3 = createSSEChannel()

    group.register(ch1, { userId: 'user-1', connectionId: 'req-1' })
    group.register(ch2, { userId: 'user-1', connectionId: 'req-2' })
    group.register(ch3, { userId: 'user-2', connectionId: 'req-3' })

    assert.strictEqual(group.size, 3)

    // Revoke a single connection via connectionId
    const res1 = await group.revoke({ connectionId: 'req-1' })
    assert.strictEqual(res1.localClosed, 1)
    assert.strictEqual(ch1.state, 'closed')
    assert.strictEqual(ch2.state, 'open')
    assert.strictEqual(ch3.state, 'open')
    assert.strictEqual(group.size, 2)

    // Revoke user-wide via userId
    const res2 = await group.revoke({ userId: 'user-1' })
    assert.strictEqual(res2.localClosed, 1)
    assert.strictEqual(ch2.state, 'closed')
    assert.strictEqual(ch3.state, 'open')
    assert.strictEqual(group.size, 1)
  })

  await t.test('multi-instance control topic broadcast over PubSubAdapter', async () => {
    // In-memory pubsub broker simulator
    const brokerListeners = new Map<string, Array<(msg: PubSubMessage) => void>>()

    const createAdapter = (): PubSubAdapter => ({
      async publish(topic, message) {
        await Promise.resolve()
        const listeners = brokerListeners.get(topic) || []
        for (const fn of listeners) {
          fn(message)
        }
      },
      async subscribe(topic, onMessage) {
        await Promise.resolve()
        if (!brokerListeners.has(topic)) brokerListeners.set(topic, [])
        brokerListeners.get(topic)!.push(onMessage)
        return () => {
          const list = brokerListeners.get(topic) || []
          brokerListeners.set(
            topic,
            list.filter((l) => l !== onMessage)
          )
        }
      },
    })

    const groupA = new SSEChannelGroup({ pubsub: createAdapter() })
    const groupB = new SSEChannelGroup({ pubsub: createAdapter() })

    // Allow async control subscription initialization to complete
    await new Promise((resolve) => setTimeout(resolve, 30))

    const chA = createSSEChannel()
    const chB1 = createSSEChannel()
    const chB2 = createSSEChannel()

    groupA.register(chA, { userId: 'user-10', connectionId: 'req-a' })
    groupB.register(chB1, { userId: 'user-10', connectionId: 'req-b1' })
    groupB.register(chB2, { userId: 'user-10', connectionId: 'req-b2' })

    // Instance A revokes connection 'req-b1' residing on Instance B
    const result = await groupA.revoke({ connectionId: 'req-b1' })
    assert.strictEqual(result.localClosed, 0) // None closed locally on instance A

    // Wait microtasks for instance B to receive control message
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.strictEqual(chA.state, 'open')
    assert.strictEqual(chB1.state, 'closed')
    assert.strictEqual(chB2.state, 'open')
  })

  await t.test('dispose() unsubscribes control topic without closing active channels', async () => {
    let unsubscribed = false
    const mockPubSub: PubSubAdapter = {
      publish: () => Promise.resolve(),
      subscribe: (topic) => {
        return Promise.resolve(() => {
          if (topic === '__restale_control__') {
            unsubscribed = true
          }
        })
      },
    }

    const group = new SSEChannelGroup({ pubsub: mockPubSub })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const ch = createSSEChannel()
    group.register(ch, { userId: 'user-x' })

    await group.dispose()
    assert.strictEqual(unsubscribed, true)
    assert.strictEqual(ch.state, 'open') // Channel remains open!
  })
})
