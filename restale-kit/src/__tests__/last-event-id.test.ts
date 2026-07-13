import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { formatInvalidateFrame } from '@/server/core/framing.js'
import { createEventStore } from '@/server/core/event-store.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { SSEChannelGroup } from '@/server/core/channel-group.js'
import { attachSSE } from '@/server/node/attach.js'
import { toSSEResponse } from '@/server/fetch/response.js'

const decoder = new TextDecoder()

void describe('WHATWG Last-Event-ID & Event History Replay', () => {
  void it('formats SSE frames with id field when provided', () => {
    const signal = { key: ['users'] }
    const frameWithId = decoder.decode(formatInvalidateFrame(signal, '42'))
    assert.equal(frameWithId, 'id: 42\nevent: invalidate\ndata: {"key":["users"]}\n\n')

    const frameWithoutId = decoder.decode(formatInvalidateFrame(signal))
    assert.equal(frameWithoutId, 'event: invalidate\ndata: {"key":["users"]}\n\n')
  })

  void it('records events in EventStore and retrieves events after a given lastEventId', () => {
    const store = createEventStore({ capacity: 5 })
    const rec1 = store.add({ key: ['posts', 1] })
    const rec2 = store.add({ key: ['posts', 2] })
    const rec3 = store.add({ key: ['posts', 3] })

    assert.equal(rec1.id, '1')
    assert.equal(rec2.id, '2')
    assert.equal(rec3.id, '3')

    const missed = store.getEventsAfter('1')
    assert.equal(missed.length, 2)
    assert.equal(missed[0]?.id, '2')
    assert.equal(missed[1]?.id, '3')
  })

  void it('replays missed events when channel is initialized with lastEventId and eventStore', async () => {
    const store = createEventStore()
    store.add({ key: ['items', 1] }) // id '1'
    store.add({ key: ['items', 2] }) // id '2'
    store.add({ key: ['items', 3] }) // id '3'

    const channel = createSSEChannel({
      lastEventId: '1',
      eventStore: store,
    })

    const reader = channel.stream.getReader()
    const chunk1 = await reader.read()
    const chunk2 = await reader.read()

    assert.equal(chunk1.done, false)
    assert.equal(chunk2.done, false)

    if (chunk1.value !== undefined && chunk2.value !== undefined) {
      const text1 = decoder.decode(chunk1.value)
      const text2 = decoder.decode(chunk2.value)
      assert.match(text1, /id: 2/)
      assert.match(text2, /id: 3/)
    }

    channel.close()
  })

  void it('parses Last-Event-ID header in attachSSE for Node requests', async () => {
    const reqEmitter = new EventEmitter()
    const dummyReq = Object.assign(reqEmitter, {
      headers: { 'last-event-id': '100' },
    }) as unknown as IncomingMessage

    const resStream = new PassThrough()
    const dummyRes = Object.assign(resStream, {
      writeHead: () => dummyRes,
    }) as unknown as ServerResponse

    const store = createEventStore()
    store.add({ key: ['a'] }, '100')
    store.add({ key: ['b'] }, '101')

    const channel = attachSSE(dummyReq, dummyRes, { eventStore: store })
    assert.equal(channel.state, 'open')

    const chunk = await new Promise<Buffer>((resolve) => {
      resStream.once('data', (data: Buffer) => {
        resolve(data)
      })
    })

    const text = decoder.decode(chunk)
    assert.match(text, /id: 101/)
    assert.doesNotMatch(text, /id: 100/)

    channel.close()
  })

  void it('parses Last-Event-ID header in toSSEResponse for Fetch requests', async () => {
    const req = new Request('https://example.com/sse', {
      headers: {
        'Last-Event-ID': '200',
      },
    })

    const store = createEventStore()
    store.add({ key: ['x'] }, '200')
    store.add({ key: ['y'] }, '201')

    const { response, channel } = toSSEResponse(req, { eventStore: store })
    assert.equal(channel.state, 'open')
    assert.notEqual(response.body, null)

    if (response.body !== null) {
      const reader = response.body.getReader()
      const chunk = await reader.read()
      assert.equal(chunk.done, false)
      if (chunk.value !== undefined) {
        const text = decoder.decode(chunk.value)
        assert.match(text, /id: 201/)
        assert.doesNotMatch(text, /id: 200/)
      }
    }

    channel.close()
  })

  void it('retains history across SSEChannelGroup operations', () => {
    const group = new SSEChannelGroup({ eventBufferCapacity: 10 })
    const ch1 = createSSEChannel()
    group.register(ch1, { userId: 'alice' })

    group.broadcastToAll({ key: ['profile', 'alice'] })

    assert.notEqual(group.eventStore, undefined)
    if (group.eventStore !== undefined) {
      const history = group.eventStore.getEventsAfter('')
      assert.equal(history.length, 1)
      assert.equal(history[0]?.id, '1')
    }

    ch1.close()
  })
})
