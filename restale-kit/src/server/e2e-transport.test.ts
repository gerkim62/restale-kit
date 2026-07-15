import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { attachSSE } from '@/server/node/attach.js'
import { toSSEResponse } from '@/server/fetch/response.js'
import { createEventStore } from '@/server/core/event-store.js'

const decoder = new TextDecoder()

async function readStreamChunk(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const { value } = await reader.read()
  reader.releaseLock()
  return value ? decoder.decode(value) : ''
}

function createMockNodeRequest(url: string): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    url,
    headers: {},
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

  it('Fetch: toSSEResponse → invalidate → reads correct SSE frame from Response body', async () => {
    const request = new Request('https://example.com/sse?__restale_cid__=e2e-1')
    const { response, channel } = toSSEResponse(request)

    expect(channel.connectionId).toBe('e2e-1')
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    // Invalidate, then read from the Response body stream
    channel.invalidate({ key: ['todos', 1] })
    const text = await readStreamChunk(response.body!)

    expect(text).toBe('event: invalidate\ndata: {"key":["todos",1]}\n\n')
  })

  it('Fetch: toSSEResponse with eventStore emits id: field in SSE frame', async () => {
    const store = createEventStore({ capacity: 10 })
    const request = new Request('https://example.com/sse?__restale_cid__=e2e-2')
    const { response, channel } = toSSEResponse(request, { eventStore: store })

    const id = channel.invalidate({ key: ['users'] })
    expect(id).toBe('1') // auto-increment

    const text = await readStreamChunk(response.body!)
    expect(text).toBe('id: 1\nevent: invalidate\ndata: {"key":["users"]}\n\n')
  })

  it('Node: attachSSE → invalidate → reads correct SSE frame from piped stream', async () => {
    const req = createMockNodeRequest('/sse?__restale_cid__=e2e-node-1')
    const res = createMockNodeResponse()

    const channel = attachSSE(req, res)
    expect(channel.connectionId).toBe('e2e-node-1')

    channel.invalidate({ key: ['products'] })

    // Node stream pipe is asynchronous across event loop ticks
    await vi.advanceTimersByTimeAsync(50)

    const chunks = (res as any).__chunks as string[]
    expect(chunks.join('')).toBe('event: invalidate\ndata: {"key":["products"]}\n\n')
  })

  it('Fetch: batch invalidate produces single SSE frame with JSON array', async () => {
    const request = new Request('https://example.com/sse?__restale_cid__=e2e-3')
    const { response, channel } = toSSEResponse(request)

    channel.invalidate([{ key: ['todos'] }, { key: ['users'] }])
    const text = await readStreamChunk(response.body!)

    expect(text).toBe(
      'event: invalidate\ndata: [{"key":["todos"]},{"key":["users"]}]\n\n'
    )
  })

  it('Fetch: keepalive frame is correctly formatted in E2E stream', async () => {
    const request = new Request('https://example.com/sse?__restale_cid__=e2e-4')
    const { response, channel } = toSSEResponse(request, { keepaliveIntervalMs: 1000 })

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
    const { response } = toSSEResponse(request, { eventStore: store })

    const reader = response.body!.getReader()
    const { value: v1 } = await reader.read()
    const { value: v2 } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(v1)).toBe('id: evt-2\nevent: invalidate\ndata: {"key":["b"]}\n\n')
    expect(decoder.decode(v2)).toBe('id: evt-3\nevent: invalidate\ndata: {"key":["c"]}\n\n')
  })
})
