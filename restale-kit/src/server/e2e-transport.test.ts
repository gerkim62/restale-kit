import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { internal_attachSSE } from '@/server/node/attach.js'
import { internal_toSSEResponse } from '@/server/fetch/response.js'
import { createEventStore } from '@/server/core/event-store.js'
import { SSEChannelGroup } from '@/server/core/channel-group.js'

const decoder = new TextDecoder()

async function readStreamChunk(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const { value } = await reader.read()
  reader.releaseLock()
  return value ? decoder.decode(value) : ''
}

function createMockNodeRequest(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    url,
    headers,
  }) as unknown as IncomingMessage
}

function createMockNodeResponse(): ServerResponse {
  const chunks: string[] = []
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  }) as unknown as ServerResponse
  res.writeHead = vi.fn()
  ;(res as any).__chunks = chunks
  return res
}

describe('E2E: Transport → Channel → SSE Frame', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('Fetch: internal_toSSEResponse → invalidate → reads correct SSE frame from Response body', async () => {
    const request = new Request('https://example.com/sse?__restale_cid__=e2e-1')
    const { response, channel } = internal_toSSEResponse(request, { target: 'swr' })

    expect(channel.connectionId).toBe('e2e-1')
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    // Invalidate, then read from the Response body stream
    channel.invalidate({ key: ['todos', 1] })
    const text = await readStreamChunk(response.body!)

    expect(text).toBe('event: invalidate\ndata: {"key":["todos",1],"target":"swr"}\n\n')
  })

  it('Fetch: internal_toSSEResponse with eventStore emits id: field in SSE frame', async () => {
    const store = createEventStore({ capacity: 10 })
    const request = new Request('https://example.com/sse?__restale_cid__=e2e-2')
    const { response, channel } = internal_toSSEResponse(request, { target: 'swr', eventStore: store })

    const id = channel.invalidate({ key: ['users'] })
    expect(id).toBe('1') // auto-increment

    const text = await readStreamChunk(response.body!)
    expect(text).toBe('id: 1\nevent: invalidate\ndata: {"key":["users"],"target":"swr"}\n\n')
  })

  it('Fetch: group event history is replayed to a transport-created reconnect', async () => {
    const eventStore = createEventStore({ capacity: 10 })
    const group = new SSEChannelGroup({ target: 'swr', eventStore })
    group.createFetchResponse(new Request('https://example.com/sse?__restale_cid__=first'), {})
    group.broadcastToAll({ key: ['already-seen'] })
    group.broadcastToAll({ key: ['todos'] })

    const { response } = group.createFetchResponse(
      new Request('https://example.com/sse?__restale_cid__=second', { headers: { 'Last-Event-ID': '1' } }),
      {}
    )
    const text = await readStreamChunk(response.body!)

    expect(text).toBe('id: 2\nevent: invalidate\ndata: {"key":["todos"],"target":"swr"}\n\n')
  })

  it('Node: group event history is replayed to a transport-created reconnect', async () => {
    const eventStore = createEventStore({ capacity: 10 })
    const group = new SSEChannelGroup({ target: 'swr', eventStore })
    const first = createMockNodeRequest('/sse?__restale_cid__=first')
    group.attachNodeResponse(first, createMockNodeResponse(), {})
    group.broadcastToAll({ key: ['already-seen'] })
    group.broadcastToAll({ key: ['todos'] })

    const response = createMockNodeResponse()
    group.attachNodeResponse(
      createMockNodeRequest('/sse?__restale_cid__=second', { 'last-event-id': '1' }),
      response,
      {}
    )
    await vi.advanceTimersByTimeAsync(50)

    expect((response as any).__chunks.join('')).toBe(
      ':\n\nid: 2\nevent: invalidate\ndata: {"key":["todos"],"target":"swr"}\n\n'
    )
  })

  it('Node: internal_attachSSE → invalidate → reads correct SSE frame from piped stream', async () => {
    const req = createMockNodeRequest('/sse?__restale_cid__=e2e-node-1')
    const res = createMockNodeResponse()

    const channel = internal_attachSSE(req, res, { target: 'swr' })
    expect(channel.connectionId).toBe('e2e-node-1')

    channel.invalidate({ key: ['products'] })

    // Node stream pipe is asynchronous across event loop ticks
    await vi.advanceTimersByTimeAsync(50)

    const chunks = (res as any).__chunks as string[]
    expect(chunks.join('')).toBe(':\n\nevent: invalidate\ndata: {"key":["products"],"target":"swr"}\n\n')
  })

  it('Fetch: batch invalidate produces single SSE frame with JSON array', async () => {
    const request = new Request('https://example.com/sse?__restale_cid__=e2e-3')
    const { response, channel } = internal_toSSEResponse(request, { target: 'swr' })

    channel.invalidate([{ key: ['todos'] }, { key: ['users'] }])
    const text = await readStreamChunk(response.body!)

    expect(text).toBe(
      'event: invalidate\ndata: [{"key":["todos"],"target":"swr"},{"key":["users"],"target":"swr"}]\n\n'
    )
  })

  it('Fetch: keepalive frame is correctly formatted in E2E stream', async () => {
    const request = new Request('https://example.com/sse?__restale_cid__=e2e-4')
    const { response, channel } = internal_toSSEResponse(request, { target: 'swr', keepaliveIntervalMs: 1000 })

    const reader = response.body!.getReader()

    await vi.advanceTimersByTimeAsync(1000)

    const { value } = await reader.read()
    reader.releaseLock()
    const text = decoder.decode(value)
    expect(text).toBe(': keepalive\n\n')
  })

  it('Fetch: event replay on reconnect with lastEventId', async () => {
    const store = createEventStore({ capacity: 10 })
    store.add({ key: ['a'] }, 'evt-1')
    store.add({ key: ['b'] }, 'evt-2')
    store.add({ key: ['c'] }, 'evt-3')

    // Simulate reconnection with Last-Event-ID header
    const request = new Request('https://example.com/sse?__restale_cid__=e2e-5', {
      headers: { 'Last-Event-ID': 'evt-1' },
    })
    const { response } = internal_toSSEResponse(request, { target: 'swr', eventStore: store })

    const reader = response.body!.getReader()
    const { value: v1 } = await reader.read()
    const { value: v2 } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(v1)).toBe('id: evt-2\nevent: invalidate\ndata: {"key":["b"]}\n\n')
    expect(decoder.decode(v2)).toBe('id: evt-3\nevent: invalidate\ndata: {"key":["c"]}\n\n')
  })

  it('Fetch: internal_toSSEResponse emits X-ReStale-Target and X-ReStale-Supported headers', () => {
    const request = new Request('https://example.com/sse?__restale_cid__=e2e-target&__restale_target__=swr')
    const { response, channel } = internal_toSSEResponse(request, { target: ['swr', 'tanstack-query'] })

    expect(channel.target).toEqual(['swr', 'tanstack-query'])
    expect(response.headers.get('x-restale-target')).toBe('swr')
    expect(response.headers.get('x-restale-supported')).toBe('swr, tanstack-query')
  })
})
