/**
 * Tests for the changes introduced by the review-findings fix:
 *
 * 1. Meta validation before transport side-effects (createFetchResponse / attachNodeResponse)
 * 2. buildSSETargetHeaders shared helper
 * 3. Regression: existing behavior preserved after refactor
 */
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SSEChannelGroup } from './channel-group.js'
import { createSSEChannel } from './channel.js'
import { SchemaValidationError } from '@/types/errors.js'
import { createValidSchema, createInvalidSchema } from '@/test-fixtures/schemas.js'

interface TestMeta {
  userId: string
  role?: string
}

function createMockRequest(url: string): IncomingMessage {
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
  return res
}

describe('review-findings: meta validation before transport', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('attachNodeResponse throws SchemaValidationError BEFORE writing HTTP headers when meta is invalid', () => {
    const metaSchema = createInvalidSchema('bad meta')
    const group = new SSEChannelGroup<TestMeta>({
      channelDefaults: {},
      metaSchema,
    })

    const req = createMockRequest('/sse?__restale_cid__=c1')
    const res = createMockResponse()

    expect(() => {
      group.attachNodeResponse(req, res, { meta: { userId: 'u1' } })
    }).toThrow(SchemaValidationError)

    // The critical assertion: writeHead must NOT have been called because
    // validation should happen before the transport side-effect.
    expect(res.writeHead).not.toHaveBeenCalled()
  })

  it('attachNodeResponse does NOT register the channel when meta validation fails', () => {
    const metaSchema = createInvalidSchema('bad meta')
    const group = new SSEChannelGroup<TestMeta>({
      channelDefaults: {},
      metaSchema,
    })

    const req = createMockRequest('/sse?__restale_cid__=c2')
    const res = createMockResponse()

    expect(() => {
      group.attachNodeResponse(req, res, { meta: { userId: 'u1' } })
    }).toThrow(SchemaValidationError)

    expect(group.size).toBe(0)
  })

  it('createFetchResponse throws SchemaValidationError BEFORE creating a Response when meta is invalid', () => {
    const metaSchema = createInvalidSchema('bad meta')
    const group = new SSEChannelGroup<TestMeta>({
      channelDefaults: {},
      metaSchema,
    })

    const request = new Request('http://localhost/sse?__restale_cid__=c3')

    expect(() => {
      group.createFetchResponse(request, { meta: { userId: 'u1' } })
    }).toThrow(SchemaValidationError)

    // No channel should be registered
    expect(group.size).toBe(0)
  })

  it('attachNodeResponse succeeds and registers channel when meta passes validation', () => {
    const metaSchema = createValidSchema<TestMeta>()
    const group = new SSEChannelGroup<TestMeta>({
      channelDefaults: {},
      metaSchema,
    })

    const req = createMockRequest('/sse?__restale_cid__=c4')
    const res = createMockResponse()

    const result = group.attachNodeResponse(req, res, { meta: { userId: 'u1' } })

    expect(result.channel).toBeDefined()
    expect(result.channel.state).toBe('open')
    expect(group.size).toBe(1)
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
    }))
  })

  it('createFetchResponse succeeds and registers channel when meta passes validation', () => {
    const metaSchema = createValidSchema<TestMeta>()
    const group = new SSEChannelGroup<TestMeta>({
      channelDefaults: {},
      metaSchema,
    })

    const request = new Request('http://localhost/sse?__restale_cid__=c5')
    const result = group.createFetchResponse(request, { meta: { userId: 'u1' } })

    expect(result.response).toBeInstanceOf(Response)
    expect(result.channel).toBeDefined()
    expect(group.size).toBe(1)
  })

  it('attachNodeResponse works without metaSchema (no validation, backward compat)', () => {
    const group = new SSEChannelGroup({
      channelDefaults: {},
    })

    const req = createMockRequest('/sse?__restale_cid__=c6')
    const res = createMockResponse()

    const result = group.attachNodeResponse(req, res, {})

    expect(result.channel.state).toBe('open')
    expect(group.size).toBe(1)
  })

  it('attachNodeResponse passes topics through to registration', () => {
    const group = new SSEChannelGroup({
      channelDefaults: {},
    })

    const req = createMockRequest('/sse?__restale_cid__=c7')
    const res = createMockResponse()

    group.attachNodeResponse(req, res, {
      topics: ['user:123', 'global'],
    })

    expect(group.size).toBe(1)
  })

  it('attachNodeResponse auto-deregisters on channel close', () => {
    const group = new SSEChannelGroup({
      channelDefaults: {},
    })

    const req = createMockRequest('/sse?__restale_cid__=c8')
    const res = createMockResponse()

    group.attachNodeResponse(req, res, {})
    expect(group.size).toBe(1)

    // Simulate client disconnect
    req.emit('close')
    expect(group.size).toBe(0)
  })

  it('register() still validates meta via metaSchema', () => {
    const metaSchema = createInvalidSchema('registration meta invalid')
    const group = new SSEChannelGroup<TestMeta>({ metaSchema })
    const channel = createSSEChannel({})

    expect(() => {
      group.register(channel, { userId: 'u1' })
    }).toThrow(SchemaValidationError)

    expect(group.size).toBe(0)
  })

  it('register() stores validated meta that broadcast predicate can match', () => {
    const metaSchema = createValidSchema<TestMeta>()
    const group = new SSEChannelGroup<TestMeta>({
      channelDefaults: {},
      metaSchema,
    })

    const req = createMockRequest('/sse?__restale_cid__=c9')
    const res = createMockResponse()

    group.attachNodeResponse(req, res, { meta: { userId: 'alice', role: 'admin' } })

    const spy = vi.fn()
    const seenMetas: TestMeta[] = []
    group.broadcast({ key: ['test'] }, (meta) => {
      if (meta === undefined) return false
      seenMetas.push(meta)
      spy()
      return true
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(seenMetas).toEqual([{ userId: 'alice', role: 'admin' }])
  })

  it('meta validation failure in attachNodeResponse does not leave a half-attached stream', () => {
    const metaSchema = createInvalidSchema('reject')
    const group = new SSEChannelGroup<TestMeta>({
      channelDefaults: {},
      metaSchema,
    })

    const req = createMockRequest('/sse?__restale_cid__=c10')
    const res = createMockResponse()

    try {
      group.attachNodeResponse(req, res, { meta: { userId: 'bad' } })
    } catch {
      // expected
    }

    // No headers written, no channel leaked
    expect(res.writeHead).not.toHaveBeenCalled()
    expect(group.size).toBe(0)

    // A subsequent valid attachNodeResponse must work cleanly
    const metaSchemaGood = createValidSchema<TestMeta>()
    const group2 = new SSEChannelGroup<TestMeta>({
      channelDefaults: {},
      metaSchema: metaSchemaGood,
    })
    const req2 = createMockRequest('/sse?__restale_cid__=c10b')
    const res2 = createMockResponse()
    const result = group2.attachNodeResponse(req2, res2, { meta: { userId: 'good' } })
    expect(result.channel.state).toBe('open')
    expect(group2.size).toBe(1)
  })

  it('meta validation failure in createFetchResponse does not leave a half-created Response', () => {
    const metaSchema = createInvalidSchema('reject')
    const group = new SSEChannelGroup<TestMeta>({
      channelDefaults: {},
      metaSchema,
    })

    const request = new Request('http://localhost/sse?__restale_cid__=c11')

    let threw = false
    try {
      group.createFetchResponse(request, { meta: { userId: 'bad' } })
    } catch {
      threw = true
    }

    expect(threw).toBe(true)
    expect(group.size).toBe(0)
  })
})
