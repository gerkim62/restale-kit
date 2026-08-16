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

  it('Fetch: keepalive frame is correctly formatted in E2E stream', async () => {
    const request = new Request('https://example.com/sse')
    const { response, channel } = internal_toSSEResponse(request, { keepaliveIntervalMs: 1000 })

    const reader = response.body!.getReader()

    // First frame is connected
    const { value: connectedVal } = await reader.read()
    expect(decoder.decode(connectedVal)).toBe(`event: connected\ndata: {"connectionId":"${channel.connectionId}"}\n\n`)

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
    const request = new Request('https://example.com/sse', {
      headers: { 'Last-Event-ID': 'evt-1' },
    })
    const { response, channel } = internal_toSSEResponse(request, { eventStore: store })

    const reader = response.body!.getReader()
    const { value: v0 } = await reader.read()
    const { value: v1 } = await reader.read()
    const { value: v2 } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(v0)).toBe(`event: connected\ndata: {"connectionId":"${channel.connectionId}"}\n\n`)
    expect(decoder.decode(v1)).toBe('id: evt-2\nevent: invalidate\ndata: {"key":["b"]}\n\n')
    expect(decoder.decode(v2)).toBe('id: evt-3\nevent: invalidate\ndata: {"key":["c"]}\n\n')
  })
})
