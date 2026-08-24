import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SSEChannelGroup } from './channel-group.js'
import { createSSEChannel } from './channel.js'
import type { PubSubAdapter, PubSubMessage } from '@/pubsub/core/index.js'
import { createValidSchema, createInvalidSchema } from '@/test-fixtures/schemas.js'
import { extractRawId, verifyToken } from '@/utils/hmac.js'
import { createEventStore } from './event-store.js'

function createMockNodeRequest(method = 'GET', body?: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const req = Object.assign(new EventEmitter(), {
    method,
    url: '/sse',
    headers,
    body,
  }) as unknown as IncomingMessage
  return req
}

function createMockNodeResponse(): ServerResponse & {
  _status?: number
  _headers: Record<string, string>
  _body?: string
} {
  const res = new Writable({
    write(chunk: unknown, _encoding: unknown, callback: () => void) {
      res._body = (res._body ?? '') + String(chunk)
      callback()
    },
  }) as unknown as ServerResponse & {
    _status?: number
    _headers: Record<string, string>
    _body?: string
  }
  res._headers = {}
  res.writeHead = vi.fn((status: number, headers?: any) => {
    res._status = status
    if (headers) Object.assign(res._headers, headers)
    return res
  }) as any
  res.setHeader = vi.fn((name: string, value: string) => {
    res._headers[name.toLowerCase()] = value
    return res
  })
  return res
}

function createMockFastifyReply(): any {
  const headers: Record<string, string> = {}
  const raw = {
    writeHead: vi.fn((status: number, hdrs?: any) => {
      if (hdrs) Object.assign(headers, hdrs)
    }),
    end: vi.fn(),
  }
  return {
    raw,
    header: vi.fn((name: string, value: string) => {
      headers[name.toLowerCase()] = value
    }),
    send: vi.fn(),
    _headers: headers,
  }
}

function createMockPubSub(): PubSubAdapter & {
  subscriptions: Map<string, (msg: PubSubMessage) => void>
  published: Array<{ topic: string; message: PubSubMessage }>
} {
  const subscriptions = new Map<string, (msg: PubSubMessage) => void>()
  const published: Array<{ topic: string; message: PubSubMessage }> = []

  return {
    subscriptions,
    published,
    publish: vi.fn((topic: string, message: PubSubMessage) => {
      published.push({ topic, message })
      return Promise.resolve()
    }),
    subscribe: vi.fn((topic: string, callback: (msg: PubSubMessage) => void) => {
      subscriptions.set(topic, callback)
      return Promise.resolve(() => {
        subscriptions.delete(topic)
      })
    }),
  }
}

interface UserMeta {
  userId: string
  orgId: string
  roles: string[]
  dynamicTimestamp?: number
}

interface ClientCtx {
  page: number
  sortBy?: string
}

describe('SSEChannelGroup Specification Compliance', () => {
  const secret = 'super-secret-key-for-testing-12345'

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Phase 4: Constructor Validations & Lifecycle', () => {
    it('throws Error if secret is omitted, empty, or whitespace', () => {
      // @ts-expect-error secret is required
      expect(() => new SSEChannelGroup({})).toThrow(/secret is required/)
      expect(() => new SSEChannelGroup({ secret: '' })).toThrow(/secret is required/)
      expect(() => new SSEChannelGroup({ secret: '   ' })).toThrow(/secret is required/)
    })

    it('throws Error if scopeBy contains empty or non-string keys', () => {
      expect(() => new SSEChannelGroup({ secret, scopeBy: [''] as any })).toThrow(/scopeBy must be an array of non-empty property names/)
      expect(() => new SSEChannelGroup({ secret, scopeBy: 'invalid' as any })).toThrow(/scopeBy must be an array of non-empty property names/)
    })

    it('throws RangeError if eventBufferCapacity is negative or non-integer', () => {
      expect(() => new SSEChannelGroup({ secret, eventBufferCapacity: -1 })).toThrow(RangeError)
      expect(() => new SSEChannelGroup({ secret, eventBufferCapacity: 1.5 })).toThrow(RangeError)
    })

    it('throws Error if controlTopic is empty or whitespace', () => {
      expect(() => new SSEChannelGroup({ secret, controlTopic: '' })).toThrow(/controlTopic/)
      expect(() => new SSEChannelGroup({ secret, controlTopic: '  ' })).toThrow(/controlTopic/)
    })

    it('uses default controlTopic __restale_control__ when not specified', () => {
      const group = new SSEChannelGroup({ secret })
      expect(group.controlTopic).toBe('__restale_control__')
    })

    it('auto-creates eventStore when eventBufferCapacity > 0', () => {
      const group = new SSEChannelGroup({ secret, eventBufferCapacity: 50 })
      expect(group.eventStore).toBeDefined()
    })

    it('subscribes to controlTopic if pubsub adapter is configured', () => {
      const pubsub = createMockPubSub()
      new SSEChannelGroup({ secret, pubsub, controlTopic: 'my_control' })
      expect(pubsub.subscribe).toHaveBeenCalledWith('my_control', expect.any(Function))
    })

    it('logs error if pubsub subscription fails during construction', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const failingPubSub = {
        publish: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockRejectedValue(new Error('Connection refused')),
      }
      new SSEChannelGroup({ secret, pubsub: failingPubSub })
      for (let i = 0; i < 5; i++) await Promise.resolve()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to subscribe to pubsub control topic'),
        expect.any(Error),
      )
      consoleErrorSpy.mockRestore()
    })

    it('dispose() closes all active channels and unsubscribes from pubsub', async () => {
      const pubsub = createMockPubSub()
      const group = new SSEChannelGroup({ secret, pubsub })
      const ch1 = createSSEChannel()
      const ch2 = createSSEChannel()

      group.register(ch1)
      group.register(ch2)
      expect(group.local.size).toBe(2)

      await group.dispose()

      expect(ch1.state).toBe('closed')
      expect(ch2.state).toBe('closed')
      expect(group.local.size).toBe(0)
    })
  })

  describe('Phase 5: group.local.* Operations', () => {
    it('broadcast(signal, filter) delivers to matching channels and returns { sent, errors }', async () => {
      const group = new SSEChannelGroup<UserMeta>({
        secret,
        scopeBy: ['userId', 'orgId'],
      })

      const req1 = new Request('https://example.com/sse')
      const req2 = new Request('https://example.com/sse')
      const req3 = new Request('https://example.com/sse')

      const res1 = await group.handle(req1, { meta: { userId: '1', orgId: 'eng', roles: ['admin'] } })
      const res2 = await group.handle(req2, { meta: { userId: '2', orgId: 'eng', roles: ['editor'] } })
      const res3 = await group.handle(req3, { meta: { userId: '3', orgId: 'sales', roles: ['viewer'] } })

      const reader1 = res1.body!.getReader()
      const reader2 = res2.body!.getReader()
      const reader3 = res3.body!.getReader()

      // Consume initial connected frames
      await reader1.read()
      await reader2.read()
      await reader3.read()

      // 1. Broadcast by object criteria (subset match)
      const resOrg = group.local.broadcast({ key: ['org-news'] }, { orgId: 'eng' })
      expect(resOrg).toEqual({ sent: 2, errors: 0 })

      // 2. Broadcast with predicate function
      const resAdmin = group.local.broadcast({ key: ['admin-stats'] }, (m) => m?.roles.includes('admin') ?? false)
      expect(resAdmin).toEqual({ sent: 1, errors: 0 })

      // 3. Broadcast to all with explicit true
      const resAll = group.local.broadcast({ key: ['global'] }, true)
      expect(resAll).toEqual({ sent: 3, errors: 0 })

      // 4. Passing undefined or false throws TypeError
      // @ts-expect-error test runtime guard
      expect(() => group.local.broadcast({ key: ['fail'] }, undefined)).toThrow(TypeError)
      // @ts-expect-error test runtime guard
      expect(() => group.local.broadcast({ key: ['fail'] }, false)).toThrow(TypeError)

      await group.dispose()
    })

    it('revokeWhere(filter) revokes matching channels and returns { revoked }', async () => {
      const group = new SSEChannelGroup<UserMeta>({
        secret,
        scopeBy: ['userId', 'orgId'],
      })

      const req1 = new Request('https://example.com/sse')
      const req2 = new Request('https://example.com/sse')

      await group.handle(req1, { meta: { userId: 'u1', orgId: 'eng', roles: ['admin'] } })
      await group.handle(req2, { meta: { userId: 'u2', orgId: 'sales', roles: ['user'] } })

      expect(group.local.size).toBe(2)

      const result = group.local.revokeWhere({ userId: 'u1' })
      expect(result).toEqual({ revoked: 1 })
      expect(group.local.size).toBe(1)

      const revokeAll = group.local.revokeWhere(true)
      expect(revokeAll).toEqual({ revoked: 1 })
      expect(group.local.size).toBe(0)
    })

    it('revokeByConnectionId(token, scope) cryptographically verifies and revokes', async () => {
      const group = new SSEChannelGroup<UserMeta>({
        secret,
        scopeBy: ['userId', 'orgId'],
      })

      const req = new Request('https://example.com/sse')
      const res = await group.handle(req, { meta: { userId: 'u42', orgId: 'eng', roles: ['admin'] } })
      const reader = res.body!.getReader()
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      const token = text.match(/"connectionId":"([^"]+)"/)![1]

      // 1. Empty/whitespace token throws Error
      expect(() => group.local.revokeByConnectionId('')).toThrow(/connectionId must be a non-empty string/)
      expect(() => group.local.revokeByConnectionId('  ')).toThrow(/connectionId must be a non-empty string/)

      // 2. Valid token + matching scope -> closed: true
      const resultSuccess = group.local.revokeByConnectionId(token, { userId: 'u42', orgId: 'eng' })
      expect(resultSuccess).toEqual({ closed: true })
      expect(group.local.size).toBe(0)

      // 3. Tampered token -> closed: false
      const tampered = token.slice(0, -2) + '00'
      const resultTampered = group.local.revokeByConnectionId(tampered, { userId: 'u42', orgId: 'eng' })
      expect(resultTampered).toEqual({ closed: false })

      // 4. Wrong scope -> closed: false
      const resultWrongScope = group.local.revokeByConnectionId(token, { userId: 'u999', orgId: 'eng' })
      expect(resultWrongScope).toEqual({ closed: false })
    })

    it('pushInlineData(payload, filter) resolves and pushes tailored inline cache data', async () => {
      const onMissingSpy = vi.fn()
      const group = new SSEChannelGroup<UserMeta, ClientCtx>({
        secret,
        scopeBy: ['userId', 'orgId'],
        onInlineDataResolverError: onMissingSpy,
        inlineDataResolver: (connections, payload: unknown) => {
          const p = payload as { teamId: string }
          const map = new Map()
          for (const conn of connections) {
            if (conn.meta?.userId === 'alice') {
              map.set(conn.connectionId, {
                action: 'inlineData',
                signal: { key: ['team-items', conn.clientContext?.page ?? 1] },
                inlineData: { items: [`item-for-${conn.meta?.userId ?? ''}`], team: p.teamId },
              })
            } else if (conn.meta?.userId === 'bob') {
              map.set(conn.connectionId, {
                action: 'revalidate',
                signal: { key: ['team-items'] },
              })
            }
            // intentionally omit charlie to trigger onInlineDataResolverError
          }
          return map
        },
      })

      const req1 = new Request('https://example.com/sse')
      const req2 = new Request('https://example.com/sse')
      const req3 = new Request('https://example.com/sse')

      const res1 = await group.handle(req1, { meta: { userId: 'alice', orgId: 'eng', roles: [] } })
      const res2 = await group.handle(req2, { meta: { userId: 'bob', orgId: 'eng', roles: [] } })
      const res3 = await group.handle(req3, { meta: { userId: 'charlie', orgId: 'eng', roles: [] } })

      const reader1 = res1.body!.getReader()
      const reader2 = res2.body!.getReader()
      const reader3 = res3.body!.getReader()

      // Read connected frames
      const frame1 = new TextDecoder().decode((await reader1.read()).value)
      await reader2.read()
      await reader3.read()

      const aliceToken = frame1.match(/"connectionId":"([^"]+)"/)![1]

      // Set client context for alice
      const postReq = new Request('https://example.com/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: 'CLIENT_CONTEXT',
          connectionId: aliceToken,
          clientContext: { page: 3 },
        }),
      })
      await group.handle(postReq, { meta: { userId: 'alice', orgId: 'eng', roles: [] } })

      // Push inline data only for engineering org
      await group.local.pushInlineData({ teamId: 'eng' }, { orgId: 'eng' })

      const aliceChunk = new TextDecoder().decode((await reader1.read()).value)
      expect(aliceChunk).toContain('event: invalidate')
      expect(aliceChunk).toContain('"key":["team-items",3]')
      expect(aliceChunk).toContain('"inlineData":{"items":["item-for-alice"],"team":"eng"}')

      const bobChunk = new TextDecoder().decode((await reader2.read()).value)
      expect(bobChunk).toContain('event: invalidate')
      expect(bobChunk).toContain('"key":["team-items"]')

      expect(onMissingSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          missingConnectionIds: expect.arrayContaining([expect.any(String)]),
        }),
      )

      await group.dispose()
    })

    it('pushInlineData throws Error if inlineDataResolver was not configured', async () => {
      const group = new SSEChannelGroup({ secret })
      await expect(group.local.pushInlineData({ x: 1 }, true)).rejects.toThrow(/inlineDataResolver must be configured/)
    })

    it('pushInlineData throws Error if payload is not valid JSON', async () => {
      const group = new SSEChannelGroup({
        secret,
        inlineDataResolver: () => new Map(),
      })
      // @ts-expect-error test non-JSON payload
      await expect(group.local.pushInlineData(BigInt(10), true)).rejects.toThrow(/payload must be a valid JSONValue/)
    })
  })

  describe('Phase 6: group.cluster.* Distributed Operations', () => {
    it('throws configuration Error when group.cluster.* is called without pubsub', async () => {
      const group = new SSEChannelGroup({ secret })
      await expect(group.cluster.broadcast('topic', { key: [] })).rejects.toThrow(/PubSubAdapter is not configured/)
      await expect(group.cluster.pushInlineData('topic', {})).rejects.toThrow(/PubSubAdapter is not configured/)
      await expect(group.cluster.revokeWhere(true)).rejects.toThrow(/PubSubAdapter is not configured/)
      await expect(group.cluster.revokeByConnectionId('tok')).rejects.toThrow(/PubSubAdapter is not configured/)
    })

    it('cluster.broadcast delivers to local subscribers AND publishes to pubsub broker', async () => {
      const pubsub = createMockPubSub()
      const group = new SSEChannelGroup({ secret, pubsub })

      const req = new Request('https://example.com/sse')
      const res = await group.handle(req, { topics: ['team:eng'] })
      const reader = res.body!.getReader()
      await reader.read() // connected frame

      await group.cluster.broadcast('team:eng', { key: ['todos'] })

      // 1. Delivered locally
      const localFrame = new TextDecoder().decode((await reader.read()).value)
      expect(localFrame).toContain('event: invalidate')
      expect(localFrame).toContain('"key":["todos"]')

      // 2. Published to broker
      expect(pubsub.publish).toHaveBeenCalledWith(
        'team:eng',
        expect.objectContaining({
          kind: 'signal',
          data: { key: ['todos'] },
        }),
      )

      await group.dispose()
    })

    it('cluster.pushInlineData delivers locally and publishes to control topic', async () => {
      const pubsub = createMockPubSub()
      const group = new SSEChannelGroup<UserMeta, ClientCtx>({
        secret,
        scopeBy: ['userId', 'orgId'],
        pubsub,
        inlineDataResolver: (connections, payload: unknown) => {
          const p = payload as { teamId: string }
          return new Map(
            connections.map((conn) => [
              conn.connectionId,
              {
                action: 'inlineData',
                signal: { key: ['team-updates'] },
                inlineData: { team: p.teamId },
              },
            ]),
          )
        },
      })

      const req = new Request('https://example.com/sse')
      const res = await group.handle(req, { meta: { userId: 'u1', orgId: 'eng', roles: [] }, topics: ['team:eng'] })
      const reader = res.body!.getReader()
      await reader.read() // connected frame

      await group.cluster.pushInlineData('team:eng', { teamId: 'eng' })

      // 1. Delivered locally
      const localFrame = new TextDecoder().decode((await reader.read()).value)
      expect(localFrame).toContain('event: invalidate')
      expect(localFrame).toContain('"inlineData":{"team":"eng"}')

      // 2. Published to controlTopic
      expect(pubsub.publish).toHaveBeenCalledWith('__restale_control__', {
        kind: 'inlineData',
        topic: 'team:eng',
        payload: { teamId: 'eng' },
      })

      await group.dispose()
    })

    it('cluster.revokeWhere revokes locally and publishes control message', async () => {
      const pubsub = createMockPubSub()
      const group = new SSEChannelGroup<UserMeta>({
        secret,
        scopeBy: ['userId', 'orgId'],
        pubsub,
      })

      const req = new Request('https://example.com/sse')
      await group.handle(req, { meta: { userId: 'u1', orgId: 'eng', roles: [] } })
      expect(group.local.size).toBe(1)

      await group.cluster.revokeWhere({ userId: 'u1' })

      expect(group.local.size).toBe(0)
      expect(pubsub.publish).toHaveBeenCalledWith('__restale_control__', {
        kind: 'control',
        data: {
          type: 'revokeWhere',
          criteria: { userId: 'u1' },
        },
      })
    })

    it('cluster.revokeByConnectionId verifies token and publishes control message', async () => {
      const pubsub = createMockPubSub()
      const group = new SSEChannelGroup<UserMeta>({
        secret,
        scopeBy: ['userId', 'orgId'],
        pubsub,
      })

      const req = new Request('https://example.com/sse')
      const res = await group.handle(req, { meta: { userId: 'u42', orgId: 'eng', roles: [] } })
      const reader = res.body!.getReader()
      const frame = new TextDecoder().decode((await reader.read()).value)
      const token = frame.match(/"connectionId":"([^"]+)"/)![1]
      const rawId = extractRawId(token)

      // 1. Empty/whitespace token throws
      await expect(group.cluster.revokeByConnectionId('')).rejects.toThrow(/connectionId must be a non-empty string/)

      // 2. Tampered token -> no local revocation, no cluster publish
      const tampered = token.slice(0, -2) + '00'
      await group.cluster.revokeByConnectionId(tampered, { userId: 'u42', orgId: 'eng' })
      expect(group.local.size).toBe(1)
      expect(pubsub.publish).not.toHaveBeenCalled()

      // 3. Valid token -> revokes locally AND publishes
      await group.cluster.revokeByConnectionId(token, { userId: 'u42', orgId: 'eng' })
      expect(group.local.size).toBe(0)
      expect(pubsub.publish).toHaveBeenCalledWith('__restale_control__', {
        kind: 'control',
        data: {
          type: 'revokeByConnectionId',
          connectionId: rawId,
          scope: { userId: 'u42', orgId: 'eng' },
        },
      })

      await group.dispose()
    })

    it('handles remote control messages received over pubsub', async () => {
      const pubsub = createMockPubSub()
      const group = new SSEChannelGroup<UserMeta, ClientCtx>({
        secret,
        scopeBy: ['userId', 'orgId'],
        pubsub,
        inlineDataResolver: (connections, payload: unknown) => {
          const p = payload as { update: string }
          return new Map(
            connections.map((c) => [
              c.connectionId,
              { action: 'inlineData', signal: { key: ['feed'] }, inlineData: p },
            ]),
          )
        },
      })

      const req = new Request('https://example.com/sse')
      const res = await group.handle(req, { meta: { userId: 'u42', orgId: 'eng', roles: [] }, topics: ['news'] })
      const reader = res.body!.getReader()
      const frame = new TextDecoder().decode((await reader.read()).value)
      const token = frame.match(/"connectionId":"([^"]+)"/)![1]
      const rawId = extractRawId(token)

      expect(group.local.size).toBe(1)

      const controlHandler = pubsub.subscriptions.get('__restale_control__')
      expect(controlHandler).toBeDefined()

      // 1. Remote inlineData message
      controlHandler!({
        kind: 'inlineData',
        topic: 'news',
        payload: { update: 'breaking news' },
      })
      for (let i = 0; i < 5; i++) await Promise.resolve()

      const inlineChunk = new TextDecoder().decode((await reader.read()).value)
      expect(inlineChunk).toContain('breaking news')

      // 2. Remote updateClientContext message with revision 5 is accepted
      controlHandler!({
        kind: 'control',
        data: {
          type: 'updateClientContext',
          connectionId: rawId,
          clientContext: { page: 10 },
          revision: 5,
        },
      })
      expect(group.getClientContext(token)).toEqual({ page: 10 })

      // Invalid revision in remote control message is safely ignored
      controlHandler!({
        kind: 'control',
        data: {
          type: 'updateClientContext',
          connectionId: rawId,
          clientContext: { page: 99 },
          revision: -1,
        },
      })
      expect(group.getClientContext(token)).toEqual({ page: 10 })

      controlHandler!({
        kind: 'control',
        data: {
          type: 'updateClientContext',
          connectionId: rawId,
          clientContext: { page: 2 },
          revision: 3, // older than 5
        },
      })
      expect(group.getClientContext(token)).toEqual({ page: 10 }) // remained 10

      // 3. Remote revokeByConnectionId with matching scope
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      controlHandler!({
        kind: 'control',
        data: {
          type: 'revokeByConnectionId',
          connectionId: rawId,
          scope: { userId: 'u42' },
        },
      })
      expect(group.local.size).toBe(0)

      // Malformed control message triggers error log without crashing
      controlHandler!({
        kind: 'control',
        data: null as any,
      })
      consoleErrorSpy.mockRestore()
    })
  })

  describe('Phase 7: Universal HTTP Handler group.handle()', () => {
    it('OPTIONS preflight returns 204 No Content with CORS headers (Fetch, Node, Fastify)', async () => {
      const group = new SSEChannelGroup({ secret })

      // Fetch
      const fetchReq = new Request('https://example.com/sse', { method: 'OPTIONS' })
      const fetchRes = await group.handle(fetchReq)
      expect(fetchRes.status).toBe(204)
      expect(fetchRes.headers.get('Allow')).toBe('GET, POST, OPTIONS')
      expect(fetchRes.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS')
      expect(fetchRes.headers.get('Access-Control-Max-Age')).toBe('86400')

      // Node
      const nodeReq = createMockNodeRequest('OPTIONS')
      const nodeRes = createMockNodeResponse()
      await group.handle(nodeReq, nodeRes)
      expect(nodeRes.writeHead).toHaveBeenCalledWith(
        204,
        expect.objectContaining({
          Allow: 'GET, POST, OPTIONS',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        }),
      )

      // Fastify
      const fastifyReq = { raw: { method: 'OPTIONS' } }
      const fastifyReply = createMockFastifyReply()
      await group.handle(fastifyReq as any, fastifyReply)
      expect(fastifyReply.raw.writeHead).toHaveBeenCalledWith(204, expect.objectContaining({ Allow: 'GET, POST, OPTIONS' }))
    })

    it('Unsupported methods (PUT, DELETE, PATCH) return 405 Method Not Allowed', async () => {
      const group = new SSEChannelGroup({ secret })

      const fetchReq = new Request('https://example.com/sse', { method: 'DELETE' })
      const fetchRes = await group.handle(fetchReq)
      expect(fetchRes.status).toBe(405)
      expect(fetchRes.headers.get('Allow')).toBe('GET, POST, OPTIONS')

      const nodeReq = createMockNodeRequest('PUT')
      const nodeRes = createMockNodeResponse()
      await group.handle(nodeReq, nodeRes)
      expect(nodeRes.writeHead).toHaveBeenCalledWith(
        405,
        expect.objectContaining({
          Allow: 'GET, POST, OPTIONS',
        }),
      )
    })

    it('GET initializes SSE stream with cryptographically signed token in connected frame', async () => {
      const group = new SSEChannelGroup<UserMeta>({
        secret,
        scopeBy: ['userId', 'orgId'],
      })

      const req = new Request('https://example.com/sse')
      const res = await group.handle(req, {
        meta: { userId: 'user-77', orgId: 'acme', roles: ['admin'], dynamicTimestamp: Date.now() },
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/event-stream')

      const reader = res.body!.getReader()
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toContain('event: connected')

      const match = text.match(/"connectionId":"([^"]+)"/)
      expect(match).not.toBeNull()
      const token = match![1]

      // Token verification succeeds against scoped metadata (userId + orgId)
      const verify = verifyToken(secret, token, { userId: 'user-77', orgId: 'acme' })
      expect(verify.valid).toBe(true)

      await group.dispose()
    })

    it('GET replays buffered events when Last-Event-ID header is supplied', async () => {
      const group = new SSEChannelGroup({
        secret,
        eventBufferCapacity: 10,
      })

      // Broadcast first event to establish a baseline ID in the eventStore
      const ev1 = group.eventStore!.add({ key: ['baseline'] })

      // Broadcast second event to be replayed
      group.local.broadcast({ key: ['early-news'] }, true)

      // Connect with Last-Event-ID = ev1.id
      const req = new Request('https://example.com/sse', {
        headers: { 'Last-Event-ID': ev1.id },
      })
      const res = await group.handle(req)
      const reader = res.body!.getReader()

      const chunk1 = new TextDecoder().decode((await reader.read()).value)
      expect(chunk1).toContain('event: connected')

      const chunk2 = new TextDecoder().decode((await reader.read()).value)
      expect(chunk2).toContain('event: invalidate')
      expect(chunk2).toContain('"key":["early-news"]')

      await group.dispose()
    })

    it('POST returns 500 in Node when req.body is missing (body parser omitted)', async () => {
      const group = new SSEChannelGroup({ secret })
      const req = createMockNodeRequest('POST', undefined)
      const res = createMockNodeResponse()

      await group.handle(req, res)
      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' })
      expect(res._body).toContain('[restale] Request body is missing on POST /sse')
    })

    it('POST validates purpose === "CLIENT_CONTEXT" (returns 400 on failure)', async () => {
      const group = new SSEChannelGroup({ secret })

      const req = new Request('https://example.com/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'INVALID_PURPOSE', connectionId: 'any' }),
      })

      const res = await group.handle(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('Invalid POST payload')
    })

    it('POST returns 400 on malformed JSON or invalid revision', async () => {
      const group = new SSEChannelGroup({ secret })

      // Malformed JSON in fetch
      const malformedReq = new Request('https://example.com/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json{',
      })
      const malformedRes = await group.handle(malformedReq)
      expect(malformedRes.status).toBe(400)

      // Invalid revision in Node
      const invalidRevReq = createMockNodeRequest('POST', {
        purpose: 'CLIENT_CONTEXT',
        connectionId: 'valid.token',
        revision: -5,
      })
      const invalidRevRes = createMockNodeResponse()
      await group.handle(invalidRevReq, invalidRevRes)
      expect(invalidRevRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' })
    })

    it('POST returns 403 Forbidden on HMAC signature mismatch (spoofing attempt)', async () => {
      const group = new SSEChannelGroup<UserMeta>({
        secret,
        scopeBy: ['userId', 'orgId'],
      })

      // Attacker sends victim's token with attacker's session
      const postReq = new Request('https://example.com/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: 'CLIENT_CONTEXT',
          connectionId: 'fake-raw-id.fake-signature-1234567890123456789012345678901234567890123456789012345678901234',
          clientContext: { page: 2 },
        }),
      })

      const res = await group.handle(postReq, { meta: { userId: 'attacker', orgId: 'evil', roles: [] } })
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('HMAC signature verification failed')
    })

    it('POST returns 422 Unprocessable Entity when clientContext fails schema validation', async () => {
      const clientContextSchema = createInvalidSchema('page must be a number')
      const group = new SSEChannelGroup<UserMeta, ClientCtx>({
        secret,
        scopeBy: ['userId', 'orgId'],
        clientContextSchema,
      })

      // Establish GET to get valid token
      const getReq = new Request('https://example.com/sse')
      const getRes = await group.handle(getReq, { meta: { userId: 'u1', orgId: 'eng', roles: [] } })
      const reader = getRes.body!.getReader()
      const frame = new TextDecoder().decode((await reader.read()).value)
      const token = frame.match(/"connectionId":"([^"]+)"/)![1]

      const postReq = new Request('https://example.com/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: 'CLIENT_CONTEXT',
          connectionId: token,
          clientContext: { page: 'invalid-string' },
        }),
      })

      const postRes = await group.handle(postReq, { meta: { userId: 'u1', orgId: 'eng', roles: [] } })
      expect(postRes.status).toBe(422)
      const data = await postRes.json()
      expect(data.error).toContain('page must be a number')

      await group.dispose()
    })

    it('POST applies context and returns 200 { ok: true } on valid context update', async () => {
      const clientContextSchema = createValidSchema<ClientCtx>()
      const group = new SSEChannelGroup<UserMeta, ClientCtx>({
        secret,
        scopeBy: ['userId', 'orgId'],
        clientContextSchema,
      })

      const getReq = new Request('https://example.com/sse')
      const getRes = await group.handle(getReq, { meta: { userId: 'u1', orgId: 'eng', roles: [] } })
      const reader = getRes.body!.getReader()
      const frame = new TextDecoder().decode((await reader.read()).value)
      const token = frame.match(/"connectionId":"([^"]+)"/)![1]

      const postReq = new Request('https://example.com/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: 'CLIENT_CONTEXT',
          connectionId: token,
          clientContext: { page: 4, sortBy: 'title' },
          revision: 1,
        }),
      })

      const postRes = await group.handle(postReq, { meta: { userId: 'u1', orgId: 'eng', roles: [] } })
      expect(postRes.status).toBe(200)
      expect(await postRes.json()).toEqual({ ok: true })

      expect(group.getClientContext(token)).toEqual({ page: 4, sortBy: 'title' })
      expect(group.getClientContext('non-existent-token')).toBeUndefined()

      await group.dispose()
    })

    it('POST returns 500 when pubsub is configured and clientContext is not serializable JSON', async () => {
      const pubsub = createMockPubSub()
      const group = new SSEChannelGroup({ secret, pubsub })

      // GET to obtain signed token
      const getReq = new Request('https://example.com/sse')
      const getRes = await group.handle(getReq)
      const reader = getRes.body!.getReader()
      const frame = new TextDecoder().decode((await reader.read()).value)
      const token = frame.match(/"connectionId":"([^"]+)"/)![1]

      // Monkey patch body to have a non-JSONValue like a function or BigInt in memory for Node path
      const invalidCtxReq = createMockNodeRequest('POST', {
        purpose: 'CLIENT_CONTEXT',
        connectionId: token,
        clientContext: BigInt(123) as any,
      })
      const invalidCtxRes = createMockNodeResponse()
      await group.handle(invalidCtxReq, invalidCtxRes)
      expect(invalidCtxRes.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' })

      // Fetch path with clientContextSchema returning a non-JSON value (e.g. BigInt)
      const schemaReturningNonJson = {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: () => ({ value: BigInt(123) as any }),
        },
      }
      const groupWithSchema = new SSEChannelGroup({
        secret,
        pubsub,
        clientContextSchema: schemaReturningNonJson as any,
      })
      const fetchReq = new Request('https://example.com/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: 'CLIENT_CONTEXT',
          connectionId: token,
          clientContext: { page: 1 },
        }),
      })
      const fetchRes = await groupWithSchema.handle(fetchReq)
      expect(fetchRes.status).toBe(500)
      const fetchBody = await fetchRes.json()
      expect(fetchBody).toEqual({ error: 'clientContext must be serializable JSON with pubsub.' })

      await groupWithSchema.dispose()
      await group.dispose()
    })

    it('pushInlineData handles skip action and throws on invalid action or delivery error', async () => {
      const group = new SSEChannelGroup({
        secret,
        inlineDataResolver: (connections) => {
          return new Map(
            connections.map((c) => [
              c.connectionId,
              { action: 'invalid-action' as any, signal: { key: [] } },
            ]),
          )
        },
      })

      const req = new Request('https://example.com/sse')
      await group.handle(req)

      await expect(group.local.pushInlineData({ test: true }, true)).rejects.toThrow(AggregateError)

      await group.dispose()
    })

    it('cluster.pushInlineData supports action: "revalidate" and handles delivery failures and invalid action', async () => {
      const onMissingSpy = vi.fn()
      const pubsub = createMockPubSub()
      const group = new SSEChannelGroup({
        secret,
        pubsub,
        onInlineDataResolverError: onMissingSpy,
        inlineDataResolver: (connections) => {
          const map = new Map()
          for (const conn of connections) {
            if (conn.connectionId.includes('conn-reval')) {
              map.set(conn.connectionId, { action: 'revalidate', signal: { key: ['reval-key'] } })
            } else if (conn.connectionId.includes('conn-skip')) {
              map.set(conn.connectionId, { action: 'skip' })
            }
            // other connection omitted to trigger onInlineDataResolverError
          }
          return map
        },
      })

      const ch1 = createSSEChannel({ connectionId: 'conn-reval' })
      const ch2 = createSSEChannel({ connectionId: 'conn-skip' })
      const ch3 = createSSEChannel({ connectionId: 'conn-missing' })

      group.register(ch1, undefined, { topics: ['reval-topic'] })
      group.register(ch2, undefined, { topics: ['reval-topic'] })
      group.register(ch3, undefined, { topics: ['reval-topic'] })

      const invalidateSpy = vi.spyOn(ch1, 'invalidate')

      await group.cluster.pushInlineData('reval-topic', { ok: true })

      expect(invalidateSpy).toHaveBeenCalledWith({ key: ['reval-key'] }, undefined)
      expect(onMissingSpy).toHaveBeenCalledWith({
        topic: 'reval-topic',
        missingConnectionIds: ['conn-missing'],
      })

      await group.dispose()
    })

    it('cluster topic resolver handles invalid actions and delivery exceptions', async () => {
      const pubsub = createMockPubSub()
      const group = new SSEChannelGroup({
        secret,
        pubsub,
        inlineDataResolver: (connections) => {
          return new Map(
            connections.map((c) => [
              c.connectionId,
              { action: 'invalid-topic-action' as any, signal: { key: [] } },
            ]),
          )
        },
      })

      const ch = createSSEChannel({ connectionId: 'test-ch' })
      group.register(ch, undefined, { topics: ['error-topic'] })

      await expect(group.cluster.pushInlineData('error-topic', {})).rejects.toThrow(AggregateError)

      await group.dispose()
    })
  })
})