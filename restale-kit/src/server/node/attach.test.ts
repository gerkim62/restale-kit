import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import http, { type IncomingMessage, type Server } from 'node:http'
import {
  internal_attachSSE,
  isFastifyReply,
  isFastifyRequest,
  getUnderlyingRequest,
  getUnderlyingResponse,
} from './attach.js'
import { createEventStore } from '@/server/core/event-store.js'
import { SSE_HEADERS } from '@/utils/constants.js'
import {
  createMockNodeRequest,
  createMockNodeResponse,
  readStreamUntil,
  closeHttpServer,
} from '@/test-fixtures/http-test-utils.js'

describe('node/attach type guards & underlying helpers', () => {
  it('isFastifyReply accurately distinguishes Fastify from Node and Express', () => {
    const rawRes = createMockNodeResponse()

    // Real Fastify reply structure
    const fastifyReply = { raw: rawRes, send: vi.fn(), header: vi.fn() }
    expect(isFastifyReply(fastifyReply)).toBe(true)

    // Raw Node ServerResponse (no 'raw' property)
    expect(isFastifyReply(rawRes)).toBe(false)

    // Express Response (inherits from ServerResponse, has send() but no 'raw' property)
    const expressRes = Object.assign(createMockNodeResponse(), { send: vi.fn() })
    expect(isFastifyReply(expressRes)).toBe(false)

    // Null and non-object values
    expect(isFastifyReply(null)).toBe(false)
    expect(isFastifyReply(undefined)).toBe(false)
    expect(isFastifyReply({})).toBe(false)
    expect(isFastifyReply({ raw: null })).toBe(false)
  })

  it('isFastifyRequest accurately distinguishes Fastify from Node', () => {
    const rawReq = new EventEmitter() as unknown as IncomingMessage
    const fastifyReq = { raw: rawReq }

    expect(isFastifyRequest(fastifyReq)).toBe(true)
    expect(isFastifyRequest(rawReq)).toBe(false)
    expect(isFastifyRequest(null)).toBe(false)
    expect(isFastifyRequest({})).toBe(false)
  })

  it('getUnderlyingRequest extracts the native IncomingMessage', () => {
    const rawReq = new EventEmitter() as unknown as IncomingMessage
    const fastifyReq = { raw: rawReq }

    expect(getUnderlyingRequest(rawReq)).toBe(rawReq)
    expect(getUnderlyingRequest(fastifyReq)).toBe(rawReq)
  })

  it('getUnderlyingResponse extracts the native ServerResponse', () => {
    const rawRes = createMockNodeResponse()
    const fastifyReply = { raw: rawRes, send: vi.fn() }

    expect(getUnderlyingResponse(rawRes)).toBe(rawRes)
    expect(getUnderlyingResponse(fastifyReply)).toBe(rawRes)
  })
})

describe('node internal_attachSSE', () => {
  let server: Server | undefined

  afterEach(async () => {
    await closeHttpServer(server)
    server = undefined
  })

  it('triggers disconnect on request close event', () => {
    const req = createMockNodeRequest('/sse')
    const res = createMockNodeResponse()

    const channel = internal_attachSSE(req, res, {})

    expect(typeof channel.connectionId).toBe('string')
    expect(channel.connectionId.length).toBeGreaterThan(0)

    req.emit('close')
    expect(channel.state).toBe('closed')
  })

  it('flushes response headers when the runtime supports it', () => {
    const req = createMockNodeRequest('/sse')
    const res = createMockNodeResponse()
    res.flushHeaders = vi.fn()

    internal_attachSSE(req, res, {})

    expect(res.flushHeaders).toHaveBeenCalledOnce()
    expect(res.writeHead).toHaveBeenCalledWith(200, SSE_HEADERS)
  })

  it('handles fallback when req.url is undefined', () => {
    const reqWithoutUrl = Object.assign(new EventEmitter(), {
      url: undefined,
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockNodeResponse()

    const channel = internal_attachSSE(reqWithoutUrl, res, {})
    expect(typeof channel.connectionId).toBe('string')
    expect(channel.connectionId.length).toBeGreaterThan(0)
  })

  it('replays missed events from group eventStore using last-event-id header', async () => {
    const eventStore = createEventStore()
    eventStore.add({ key: ['todos', 1] }, 'evt-1')
    eventStore.add({ key: ['todos', 2] }, 'evt-2')

    const req = createMockNodeRequest('/sse', { 'last-event-id': 'evt-1' })
    const res = createMockNodeResponse()

    const channel = internal_attachSSE(req, res, {}, { eventStore, channelDefaults: undefined })
    expect(channel.connectionId).toBeDefined()

    // Wait for the readable stream to pipe into the writable mock response
    await new Promise((resolve) => setImmediate(resolve))

    const output = res.writtenChunks.join('')
    expect(output).toContain('id: evt-2\nevent: invalidate\ndata: {"key":["todos",2]}\n\n')
    channel.close()
  })

  it('Real Node HTTP server: streams SSE frames with exact headers', async () => {
    let attachedChannel: any

    server = http.createServer((req, res) => {
      if (req.url === '/sse') {
        attachedChannel = internal_attachSSE(req, res, {})
      }
    })

    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const addr = server!.address()
        resolve(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })

    const abortController = new AbortController()
    const res = await fetch(`http://127.0.0.1:${String(port)}/sse`, {
      signal: abortController.signal,
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(res.headers.get('connection')).toBe('keep-alive')

    const reader = res.body!.getReader()

    try {
      const text = await readStreamUntil(reader, (t) => t.includes('event: connected'))
      expect(text).toContain(':\n\n')
      expect(text).toContain('event: connected\ndata: {"connectionId":')

      abortController.abort()
      await vi.waitFor(() => {
        expect(attachedChannel.state).toBe('closed')
      }, { timeout: 1000 })
    } finally {
      await reader.cancel().catch(() => {})
    }
  })
})
