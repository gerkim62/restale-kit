import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SSEChannelGroup } from './channel-group.js'
import { createSSEChannel } from './channel.js'
import { SchemaValidationError } from '@/types/errors.js'
import { createValidSchema, createInvalidSchema } from '@/test-fixtures/schemas.js'

function createMockRequest(url: string = '/sse'): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    url,
    headers: {},
  }) as unknown as IncomingMessage
}

function createMockResponse(): ServerResponse {
  const res = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  }) as unknown as ServerResponse
  res.writeHead = vi.fn()
  res.write = vi.fn()
  return res
}

interface TestMeta {
  userId: string
  role?: string
}

describe('SSEChannelGroup — review fixes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('handle (Node) throws SchemaValidationError BEFORE writing HTTP headers when meta is invalid', async () => {
    const metaSchema = createInvalidSchema('bad meta')
    const group = new SSEChannelGroup<TestMeta>({
      secret: 'sec-1',
      scopeBy: ['userId'],
      channelDefaults: {},
      metaSchema,
    })

    const req = createMockRequest('/sse')
    const res = createMockResponse()

    await expect(async () => {
      await group.handle(req, res, { meta: { userId: 'u1' } })
    }).rejects.toThrow(SchemaValidationError)

    expect(res.writeHead).not.toHaveBeenCalled()
    expect(group.local.size).toBe(0)
  })

  it('handle (Node) does NOT register the channel when meta validation fails', async () => {
    const metaSchema = createInvalidSchema('bad meta')
    const group = new SSEChannelGroup<TestMeta>({
      secret: 'sec-2',
      scopeBy: ['userId'],
      channelDefaults: {},
      metaSchema,
    })

    const req = createMockRequest('/sse')
    const res = createMockResponse()

    await expect(async () => {
      await group.handle(req, res, { meta: { userId: 'u1' } })
    }).rejects.toThrow(SchemaValidationError)

    expect(group.local.size).toBe(0)
  })

  it('handle (Fetch) throws SchemaValidationError BEFORE creating a Response when meta is invalid', async () => {
    const metaSchema = createInvalidSchema('bad meta')
    const group = new SSEChannelGroup<TestMeta>({
      secret: 'sec-3',
      scopeBy: ['userId'],
      channelDefaults: {},
      metaSchema,
    })

    const request = new Request('http://localhost/sse')

    await expect(async () => {
      await group.handle(request, { meta: { userId: 'u1' } })
    }).rejects.toThrow(SchemaValidationError)

    expect(group.local.size).toBe(0)
  })

  it('handle (Node) succeeds and registers channel when meta passes validation', async () => {
    const metaSchema = createValidSchema<TestMeta>()
    const group = new SSEChannelGroup<TestMeta>({
      secret: 'sec-4',
      scopeBy: ['userId'],
      channelDefaults: {},
      metaSchema,
    })

    const req = createMockRequest('/sse')
    const res = createMockResponse()

    await group.handle(req, res, { meta: { userId: 'u1' } })

    expect(group.local.size).toBe(1)
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream',
      }),
    )
  })

  it('handle (Fetch) succeeds and registers channel when meta passes validation', async () => {
    const metaSchema = createValidSchema<TestMeta>()
    const group = new SSEChannelGroup<TestMeta>({
      secret: 'sec-5',
      scopeBy: ['userId'],
      channelDefaults: {},
      metaSchema,
    })

    const request = new Request('http://localhost/sse')
    const response = await group.handle(request, { meta: { userId: 'u1' } })

    expect(response).toBeInstanceOf(Response)
    expect(group.local.size).toBe(1)
  })

  it('handle (Node) works without metaSchema', async () => {
    const group = new SSEChannelGroup({
      secret: 'sec-6',
      channelDefaults: {},
    })

    const req = createMockRequest('/sse')
    const res = createMockResponse()

    await group.handle(req, res, {})

    expect(group.local.size).toBe(1)
  })

  it('handle passes topics through to registration', async () => {
    const group = new SSEChannelGroup({
      secret: 'sec-7',
      channelDefaults: {},
    })

    const req = createMockRequest('/sse')
    const res = createMockResponse()

    await group.handle(req, res, {
      topics: ['user:123', 'global'],
    })

    expect(group.local.size).toBe(1)
  })

  it('handle (Node) auto-deregisters on channel close', async () => {
    const group = new SSEChannelGroup({
      secret: 'sec-8',
      channelDefaults: {},
    })

    const req = createMockRequest('/sse')
    const res = createMockResponse()

    await group.handle(req, res, {})
    expect(group.local.size).toBe(1)

    // Simulate client disconnect
    req.emit('close')
    expect(group.local.size).toBe(0)
  })

  it('register() still validates meta via metaSchema', () => {
    const metaSchema = createInvalidSchema('registration meta invalid')
    const group = new SSEChannelGroup<TestMeta>({
      secret: 'sec-9',
      scopeBy: ['userId'],
      metaSchema,
    })
    const channel = createSSEChannel({})

    expect(() => {
      group.register(channel, { userId: 'u1' })
    }).toThrow(SchemaValidationError)

    expect(group.local.size).toBe(0)
  })

  it('register() stores validated meta that broadcast filter can match', async () => {
    const metaSchema = createValidSchema<TestMeta>()
    const group = new SSEChannelGroup<TestMeta>({
      secret: 'sec-10',
      scopeBy: ['userId'],
      channelDefaults: {},
      metaSchema,
    })

    const req = createMockRequest('/sse')
    const res = createMockResponse()

    await group.handle(req, res, { meta: { userId: 'alice', role: 'admin' } })

    const spy = vi.fn()
    const seenMetas: TestMeta[] = []
    group.local.broadcast({ key: ['test'] }, (meta) => {
      if (meta === undefined) return false
      seenMetas.push(meta)
      spy()
      return true
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(seenMetas).toEqual([{ userId: 'alice', role: 'admin' }])
  })
})
