import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { SSEChannelGroup } from '../core/index.js'
import {
  createMockNodeRequest,
  createMockNodeResponse,
  readStreamUntil,
} from '@/test-fixtures/http-test-utils.js'

describe('server/fastify integration via attachNodeResponse', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
  })

  it('uses reply.send(stream) on FastifyReplyLike and sets SSE headers', () => {
    const group = new SSEChannelGroup({})
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

    const { channel } = group.attachNodeResponse(mockRequest, mockReply, {})

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(headerSpy).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(headerSpy).toHaveBeenCalledWith('Cache-Control', 'no-cache')
    expect(headerSpy).toHaveBeenCalledWith('Connection', 'keep-alive')
    expect(typeof channel.connectionId).toBe('string')
    expect(channel.connectionId.length).toBeGreaterThan(0)
    expect(channel.state).toBe('open')
    channel.close()
  })

  it('supports objects with raw ServerResponse by falling back to native Node response streaming', () => {
    const group = new SSEChannelGroup({})
    const rawReq = createMockNodeRequest('/sse')
    const rawRes = createMockNodeResponse()

    const mockRequest = { raw: rawReq }
    const mockReplyWithoutSend = { raw: rawRes }

    const { channel } = group.attachNodeResponse(mockRequest, mockReplyWithoutSend, {})

    expect(rawRes.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    expect(typeof channel.connectionId).toBe('string')
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

  describe('Real Fastify HTTP server integration (hijack-less)', () => {
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
        group.broadcastToAll({ key: ['todos'] })

        const broadcastText = await readStreamUntil(reader, (t) => t.includes('event: invalidate'))
        expect(broadcastText).toContain('event: invalidate\ndata: {"key":["todos"]}\n\n')

        abortController.abort()
        await vi.waitFor(() => {
          expect(group.size).toBe(0)
        }, { timeout: 1000 })
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('Happy path: works seamlessly with async route handlers (returning reply is optional)', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        group.attachNodeResponse(request, reply, { meta: { userId: 'u-456' } })
        // Note: returning `reply` is optional now since attachFastifyResponse guards against Fastify's wrapThenable
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
        await vi.waitFor(() => {
          expect(group.size).toBe(0)
        }, { timeout: 1000 })
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('reproduces bug: async route handler without explicit return reply (delayed attach)', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        group.attachNodeResponse(request, reply, { meta: { userId: 'u-naive-delayed' } })
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
        await vi.waitFor(() => {
          expect(group.size).toBe(0)
        }, { timeout: 1000 })
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('works with async route handler without explicit return reply (zero prior await)', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()

      // eslint-disable-next-line typescript/require-await -- Testing async handler with zero prior await
      app.get('/sse', async (request, reply) => {
        group.attachNodeResponse(request, reply, { meta: { userId: 'u-naive-immediate' } })
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
        await vi.waitFor(() => {
          expect(group.size).toBe(0)
        }, { timeout: 1000 })
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('Happy path: Fastify hooks (onSend, onResponse) execute properly with reply.send()', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()
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

      let sseChannel: any
      app.get('/sse', (request, reply) => {
        const { channel } = group.attachNodeResponse(request, reply, { meta: { userId: 'u-789' } })
        sseChannel = channel
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })

      const res = await fetch(`${address}/sse`)
      expect(onSendFired).toBe(true)
      expect(res.headers.get('x-sse-hook')).toBe('active')

      // Server closes channel
      sseChannel.close()

      // Read response until complete
      const reader = res.body!.getReader()
      try {
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }

        await vi.waitFor(() => {
          expect(onResponseFired).toBe(true)
        }, { timeout: 1000 })
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('Test 3: regression guard, hooks (onSend, onResponse) and headers still fire for naive async handler with no return', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()
      let onResponseFired = false
      let onSendFired = false

      app.addHook('onSend', (_request, reply, _payload, done) => {
        onSendFired = true
        reply.header('x-custom-cors', 'allowed')
        done()
      })

      app.addHook('onResponse', (_request, _reply, done) => {
        onResponseFired = true
        done()
      })

      let sseChannel: any
      app.get('/sse', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        const { channel } = group.attachNodeResponse(request, reply, { meta: { userId: 'u-hooks-async' } })
        sseChannel = channel
      })

      const address = await app.listen({ port: 0, host: '127.0.0.1' })

      const res = await fetch(`${address}/sse`)
      expect(onSendFired).toBe(true)
      expect(res.headers.get('x-custom-cors')).toBe('allowed')

      // Server closes channel
      sseChannel.close()

      // Read response until complete
      const reader = res.body!.getReader()
      try {
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }

        await vi.waitFor(() => {
          expect(onResponseFired).toBe(true)
        }, { timeout: 1000 })
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('Test 4: non-streaming routes on the same app are unaffected', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        group.attachNodeResponse(request, reply, { meta: { userId: 'u-mix' } })
      })

      // eslint-disable-next-line typescript/require-await -- Testing normal async JSON route
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
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
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

    it('Test 6: client disconnect cleanup still works on aborted client fetch', async () => {
      app = Fastify()
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', async (request, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        group.attachNodeResponse(request, reply, { meta: { userId: 'u-disconnect' } })
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
        expect(group.size).toBe(1)

        abortController.abort()

        await vi.waitFor(() => {
          expect(group.size).toBe(0)
        }, { timeout: 1000 })
      } finally {
        await reader.cancel().catch(() => {})
      }
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
      try {
        // Read connected
        const initialText = await readStreamUntil(reader, (t) => t.includes('event: connected'))
        expect(initialText).toContain('event: connected')

        // Server revokes user connection
        await group.revokeWhere({ userId: 'u-revoked' })

        // Read until revoke frame is received
        const revokeText = await readStreamUntil(reader, (t) => t.includes('event: revoke'))
        expect(revokeText).toContain('event: revoke')

        // Stream should be closed by server
        const chunk3 = await reader.read()
        expect(chunk3.done).toBe(true)
        expect(group.size).toBe(0)
      } finally {
        await reader.cancel().catch(() => {})
      }
    })
  })
})
