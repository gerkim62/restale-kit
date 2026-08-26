import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import Fastify, { type FastifyInstance } from 'fastify'
import { SSEChannelGroup } from '../core/index'
import {
  createMockNodeRequest,
  createMockNodeResponse,
  readStreamUntil,
} from '@/test-fixtures/http-test-utils'

describe('server/fastify integration via group.handle', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
  })

  it('uses reply.send(stream) on FastifyReplyLike and sets SSE headers', async () => {
    const group = new SSEChannelGroup({ secret: 'fastify-secret-1' })
    const rawReq = createMockNodeRequest('/sse')
    const rawRes = createMockNodeResponse()

    const sendSpy = vi.fn()
    const headerSpy = vi.fn()

    const mockRequest = { raw: rawReq }
    const mockReply = {
      raw: rawRes,
      send: sendSpy,
      header: headerSpy,
    }

    await group.handle(mockRequest, mockReply, {})

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(headerSpy).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(headerSpy).toHaveBeenCalledWith('Cache-Control', 'no-cache')
    expect(headerSpy).toHaveBeenCalledWith('Connection', 'keep-alive')
    expect(group.local.size).toBe(1)
    await group.dispose()
  })

  describe('Real Fastify HTTP server integration (hijack-less)', () => {
    it('Happy path: streams SSE frames to real HTTP client and receives broadcasts', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>({
        secret: 'fastify-secret-2',
        scopeBy: ['userId'],
      })

      app.get('/sse', (request, reply) => {
        return group.handle(request, reply, { meta: { userId: 'u-123' } })
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })
      const abortController = new AbortController()

      const res = await fetch(`${address}/sse`, {
        signal: abortController.signal,
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(res.headers.get('connection')).toBe('keep-alive')

      const reader = res.body!.getReader()
      try {
        // Read until connected frame is received
        const initialText = await readStreamUntil(reader, (t) => t.includes('event: connected'))
        expect(initialText).toContain(':\n\n')
        expect(initialText).toContain('event: connected\ndata: {"connectionId":')

        // Broadcast an invalidation signal
        group.local.broadcast({ key: ['todos'] }, true)

        const broadcastText = await readStreamUntil(reader, (t) => t.includes('event: invalidate'))
        expect(broadcastText).toContain('event: invalidate\ndata: {"key":["todos"]}\n\n')

        abortController.abort()
        await vi.waitFor(
          () => {
            expect(group.local.size).toBe(0)
          },
          { timeout: 1000 },
        )
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('Happy path: works seamlessly with async route handlers', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>({
        secret: 'fastify-secret-3',
        scopeBy: ['userId'],
      })

      app.get('/sse', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return group.handle(request, reply, { meta: { userId: 'u-456' } })
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })
      const abortController = new AbortController()

      const res = await fetch(`${address}/sse`, {
        signal: abortController.signal,
      })

      expect(res.status).toBe(200)
      const reader = res.body!.getReader()
      try {
        const text = await readStreamUntil(reader, (t) => t.includes('event: connected'))
        expect(text).toContain('event: connected')

        abortController.abort()
        await vi.waitFor(
          () => {
            expect(group.local.size).toBe(0)
          },
          { timeout: 1000 },
        )
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('Happy path: Fastify hooks (onSend, onResponse) execute properly with reply.send()', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>({
        secret: 'fastify-secret-4',
        scopeBy: ['userId'],
      })
      let onResponseFired = false
      let onSendFired = false

      app.addHook('onSend', (_request, reply, _payload, done) => {
        onSendFired = true
        reply.header('x-sse-hook', 'active')
        done()
      })

      app.addHook('onResponse', (_request, _reply, done) => {
        onResponseFired = true
        done()
      })

      app.get('/sse', (request, reply) => {
        return group.handle(request, reply, { meta: { userId: 'u-789' } })
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })

      const res = await fetch(`${address}/sse`)
      expect(onSendFired).toBe(true)
      expect(res.headers.get('x-sse-hook')).toBe('active')

      // Server revokes user channel to close stream
      group.local.revokeWhere({ userId: 'u-789' })

      // Read response until complete
      const reader = res.body!.getReader()
      try {
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }

        await vi.waitFor(
          () => {
            expect(onResponseFired).toBe(true)
          },
          { timeout: 1000 },
        )
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('Test 4: non-streaming routes on the same app are unaffected', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>({
        secret: 'fastify-secret-5',
        scopeBy: ['userId'],
      })

      app.get('/sse', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return group.handle(request, reply, { meta: { userId: 'u-mix' } })
      })

      // eslint-disable-next-line typescript/require-await
      app.get('/api/data', async () => {
        return { ok: true }
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })

      const jsonRes = await fetch(`${address}/api/data`)
      expect(jsonRes.status).toBe(200)
      const data = await jsonRes.json()
      expect(data).toEqual({ ok: true })
    })

    it('Test 5: early exit / 401 unauthorized before attach is unaffected', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>({
        secret: 'fastify-secret-6',
        scopeBy: ['userId'],
      })

      app.get('/sse', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        const auth = (request.query as Record<string, string>)?.token
        if (!auth) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }
        return group.handle(request, reply, { meta: { userId: 'u-999' } })
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })

      const res = await fetch(`${address}/sse`)
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toEqual({ error: 'Unauthorized' })
      expect(group.local.size).toBe(0)
    })

    it('Test 6: client disconnect cleanup still works on aborted client fetch', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>({
        secret: 'fastify-secret-7',
        scopeBy: ['userId'],
      })

      app.get('/sse', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return group.handle(request, reply, { meta: { userId: 'u-disconnect' } })
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })
      const abortController = new AbortController()

      const res = await fetch(`${address}/sse`, {
        signal: abortController.signal,
      })

      expect(res.status).toBe(200)
      const reader = res.body!.getReader()
      try {
        const text = await readStreamUntil(reader, (t) => t.includes('event: connected'))
        expect(text).toContain('event: connected')
        expect(group.local.size).toBe(1)

        abortController.abort()

        await vi.waitFor(
          () => {
            expect(group.local.size).toBe(0)
          },
          { timeout: 1000 },
        )
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('Happy path: server-side revoke closes stream cleanly and notifies client', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>({
        secret: 'fastify-secret-8',
        scopeBy: ['userId'],
      })

      app.get('/sse', (request, reply) => {
        return group.handle(request, reply, { meta: { userId: 'u-revoked' } })
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })

      const res = await fetch(`${address}/sse`)
      const reader = res.body!.getReader()
      try {
        // Read connected
        const initialText = await readStreamUntil(reader, (t) => t.includes('event: connected'))
        expect(initialText).toContain('event: connected')

        // Server revokes user connection
        group.local.revokeWhere({ userId: 'u-revoked' })

        // Read until revoke frame is received
        const revokeText = await readStreamUntil(reader, (t) => t.includes('event: revoke'))
        expect(revokeText).toContain('event: revoke')

        // Stream should be closed by server
        const chunk3 = await reader.read()
        expect(chunk3.done).toBe(true)
        expect(group.local.size).toBe(0)
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('handles Fastify reply with raw.setHeader fallback when header() is missing', async () => {
      const group = new SSEChannelGroup({ secret: 'sec-fastify-raw' })
      const setHeaderSpy = vi.fn()
      const req = { raw: Object.assign(new EventEmitter(), { method: 'GET', headers: {} }) }
      const reply = {
        raw: {
          setHeader: setHeaderSpy,
          writeHead: vi.fn(),
          end: vi.fn(),
        },
        send: vi.fn(),
      }

      await group.handle(req as any, reply as any)
      expect(setHeaderSpy).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
      await group.dispose()
    })
  })
})
