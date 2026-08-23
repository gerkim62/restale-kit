import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import Fastify, { type FastifyInstance } from 'fastify'
import { SSEChannelGroup } from '../core/index.js'

function createMockNodeRequest(url: string): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    url,
    headers: {},
  }) as unknown as IncomingMessage
}

function createMockNodeResponse(): ServerResponse {
  const res = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  }) as unknown as ServerResponse
  res.writeHead = vi.fn()
  return res
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 1500
): Promise<string> {
  const decoder = new TextDecoder()
  let accumulated = ''
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const { value, done } = await reader.read()
    if (done) break
    accumulated += decoder.decode(value, { stream: true })
    if (predicate(accumulated)) return accumulated
  }
  return accumulated
}

describe('server/fastify integration via attachNodeResponse', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
  })

  it('automatically invokes reply.hijack() on FastifyReplyLike response object', () => {
    const group = new SSEChannelGroup({})
    const rawReq = createMockNodeRequest('/sse')
    const rawRes = createMockNodeResponse()
    const hijackSpy = vi.fn()

    const mockRequest = { raw: rawReq }
    const mockReply = {
      raw: rawRes,
      hijack: hijackSpy,
    }

    const { channel } = group.attachNodeResponse(mockRequest, mockReply, {})

    expect(hijackSpy).toHaveBeenCalledTimes(1)
    expect(typeof channel.connectionId).toBe('string')
    expect(channel.connectionId.length).toBeGreaterThan(0)
    expect(channel.state).toBe('open')
    channel.close()
  })

  it('works directly with raw IncomingMessage and ServerResponse', () => {
    const group = new SSEChannelGroup({})
    const rawReq = createMockNodeRequest('/sse')
    const rawRes = createMockNodeResponse()

    const { channel } = group.attachNodeResponse(rawReq, rawRes, {})

    expect(typeof channel.connectionId).toBe('string')
    expect(channel.connectionId.length).toBeGreaterThan(0)
    expect(channel.state).toBe('open')
    channel.close()
  })

  describe('Real Fastify HTTP server integration (TDD)', () => {
    it('Happy path: streams SSE frames to real HTTP client and receives broadcasts', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', (request, reply) => {
        group.attachNodeResponse(request, reply, { meta: { userId: 'u-123' } })
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })
      const abortController = new AbortController()

      const res = await fetch(`${address}/sse`, {
        signal: abortController.signal,
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(res.headers.get('connection')).toBe('keep-alive')

      const reader = res.body!.getReader()

      // Read until connected frame is received
      const initialText = await readUntil(reader, (t) => t.includes('event: connected'))
      expect(initialText).toContain(':\n\n')
      expect(initialText).toContain('event: connected\ndata: {"connectionId":')

      // Broadcast an invalidation signal
      group.broadcastToAll({ key: ['todos'] })

      const broadcastText = await readUntil(reader, (t) => t.includes('event: invalidate'))
      expect(broadcastText).toContain('event: invalidate\ndata: {"key":["todos"]}\n\n')

      abortController.abort()
      await new Promise((r) => setTimeout(r, 50))

      expect(group.size).toBe(0)
    })

    it('Happy path: works seamlessly with async route handlers', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', async (request, reply) => {
        // Simulating async auth check
        await new Promise((resolve) => setTimeout(resolve, 10))
        group.attachNodeResponse(request, reply, { meta: { userId: 'u-456' } })
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })
      const abortController = new AbortController()

      const res = await fetch(`${address}/sse`, {
        signal: abortController.signal,
      })

      expect(res.status).toBe(200)
      const reader = res.body!.getReader()
      const text = await readUntil(reader, (t) => t.includes('event: connected'))
      expect(text).toContain('event: connected')

      abortController.abort()
      await new Promise((r) => setTimeout(r, 50))
      expect(group.size).toBe(0)
    })

    it('Sad path: early exit / 401 unauthorized in route handler before attach', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', (request, reply) => {
        const auth = (request.query as Record<string, string>)?.token
        if (!auth) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }
        group.attachNodeResponse(request, reply, { meta: { userId: 'u-999' } })
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })

      const res = await fetch(`${address}/sse`)
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toEqual({ error: 'Unauthorized' })
      expect(group.size).toBe(0)
    })

    it('Happy path: server-side revoke closes stream cleanly and notifies client', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', (request, reply) => {
        group.attachNodeResponse(request, reply, { meta: { userId: 'u-revoked' } })
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })

      const res = await fetch(`${address}/sse`)
      const reader = res.body!.getReader()

      // Read connected
      const initialText = await readUntil(reader, (t) => t.includes('event: connected'))
      expect(initialText).toContain('event: connected')

      // Server revokes user connection
      await group.revokeWhere({ userId: 'u-revoked' })

      // Read until revoke frame is received
      const revokeText = await readUntil(reader, (t) => t.includes('event: revoke'))
      expect(revokeText).toContain('event: revoke')

      // Stream should be closed by server
      const chunk3 = await reader.read()
      expect(chunk3.done).toBe(true)
      expect(group.size).toBe(0)
    })
  })
})
