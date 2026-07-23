/**
 * Tests for the changes introduced by the review-findings fix:
 *
 * 1. Meta validation before transport side-effects (createChannel / attachChannel)
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
import { buildSSETargetHeaders } from '@/server/transport-utils.js'
import { SSE_HEADERS, SSE_RESPONSE_HEADERS } from '@/utils/constants.js'

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

  it('attachChannel throws SchemaValidationError BEFORE writing HTTP headers when meta is invalid', () => {
    const metaSchema = createInvalidSchema('bad meta')
    const group = new SSEChannelGroup<any, TestMeta>({
      channelDefaults: { target: 'swr' },
      metaSchema,
    })

    const req = createMockRequest('/sse?__restale_cid__=c1')
    const res = createMockResponse()

    expect(() => {
      group.attachChannel(req, res, { meta: { userId: 'u1' } })
    }).toThrow(SchemaValidationError)

    // The critical assertion: writeHead must NOT have been called because
    // validation should happen before the transport side-effect.
    expect(res.writeHead).not.toHaveBeenCalled()
  })

  it('attachChannel does NOT register the channel when meta validation fails', () => {
    const metaSchema = createInvalidSchema('bad meta')
    const group = new SSEChannelGroup<any, TestMeta>({
      channelDefaults: { target: 'swr' },
      metaSchema,
    })

    const req = createMockRequest('/sse?__restale_cid__=c2')
    const res = createMockResponse()

    expect(() => {
      group.attachChannel(req, res, { meta: { userId: 'u1' } })
    }).toThrow(SchemaValidationError)

    expect(group.size).toBe(0)
  })

  it('createChannel throws SchemaValidationError BEFORE creating a Response when meta is invalid', () => {
    const metaSchema = createInvalidSchema('bad meta')
    const group = new SSEChannelGroup<any, TestMeta>({
      channelDefaults: { target: 'swr' },
      metaSchema,
    })

    const request = new Request('http://localhost/sse?__restale_cid__=c3')

    expect(() => {
      group.createChannel(request, { meta: { userId: 'u1' } })
    }).toThrow(SchemaValidationError)

    // No channel should be registered
    expect(group.size).toBe(0)
  })

  it('attachChannel succeeds and registers channel when meta passes validation', () => {
    const metaSchema = createValidSchema<TestMeta>()
    const group = new SSEChannelGroup<any, TestMeta>({
      channelDefaults: { target: 'swr' },
      metaSchema,
    })

    const req = createMockRequest('/sse?__restale_cid__=c4')
    const res = createMockResponse()

    const result = group.attachChannel(req, res, { meta: { userId: 'u1' } })

    expect(result.channel).toBeDefined()
    expect(result.channel.state).toBe('open')
    expect(group.size).toBe(1)
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
    }))
  })

  it('createChannel succeeds and registers channel when meta passes validation', () => {
    const metaSchema = createValidSchema<TestMeta>()
    const group = new SSEChannelGroup<any, TestMeta>({
      channelDefaults: { target: 'swr' },
      metaSchema,
    })

    const request = new Request('http://localhost/sse?__restale_cid__=c5')
    const result = group.createChannel(request, { meta: { userId: 'u1' } })

    expect(result.response).toBeInstanceOf(Response)
    expect(result.channel).toBeDefined()
    expect(group.size).toBe(1)
  })

  it('attachChannel works without metaSchema (no validation, backward compat)', () => {
    const group = new SSEChannelGroup({
      channelDefaults: { target: 'swr' },
    })

    const req = createMockRequest('/sse?__restale_cid__=c6')
    const res = createMockResponse()

    const result = group.attachChannel(req, res, {})

    expect(result.channel.state).toBe('open')
    expect(group.size).toBe(1)
  })

  it('attachChannel passes topics through to registration', () => {
    const group = new SSEChannelGroup({
      channelDefaults: { target: 'swr' },
    })

    const req = createMockRequest('/sse?__restale_cid__=c7')
    const res = createMockResponse()

    group.attachChannel(req, res, {
      topics: ['user:123', 'global'],
    })

    expect(group.size).toBe(1)
  })

  it('attachChannel auto-deregisters on channel close', async () => {
    const group = new SSEChannelGroup({
      channelDefaults: { target: 'swr' },
    })

    const req = createMockRequest('/sse?__restale_cid__=c8')
    const res = createMockResponse()

    group.attachChannel(req, res, {})
    expect(group.size).toBe(1)

    // Simulate client disconnect
    req.emit('close')
    expect(group.size).toBe(0)
  })

  it('register() still validates meta via metaSchema', () => {
    const metaSchema = createInvalidSchema('registration meta invalid')
    const group = new SSEChannelGroup<any, TestMeta>({ metaSchema })
    const channel = createSSEChannel({ target: 'swr' })

    expect(() => {
      group.register(channel, { userId: 'u1' })
    }).toThrow(SchemaValidationError)

    expect(group.size).toBe(0)
  })

  it('register() stores validated meta that broadcast predicate can match', () => {
    const metaSchema = createValidSchema<TestMeta>()
    const group = new SSEChannelGroup<any, TestMeta>({
      channelDefaults: { target: 'swr' },
      metaSchema,
    })

    const req = createMockRequest('/sse?__restale_cid__=c9')
    const res = createMockResponse()

    group.attachChannel(req, res, { meta: { userId: 'alice', role: 'admin' } })

    const spy = vi.fn()
    const seenMetas: TestMeta[] = []
    group.broadcast({ key: ['test'] }, (meta) => {
      seenMetas.push(meta)
      spy()
      return true
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(seenMetas).toEqual([{ userId: 'alice', role: 'admin' }])
  })

  it('meta validation failure in attachChannel does not leave a half-attached stream', () => {
    const metaSchema = createInvalidSchema('reject')
    const group = new SSEChannelGroup<any, TestMeta>({
      channelDefaults: { target: 'swr' },
      metaSchema,
    })

    const req = createMockRequest('/sse?__restale_cid__=c10')
    const res = createMockResponse()

    try {
      group.attachChannel(req, res, { meta: { userId: 'bad' } })
    } catch {
      // expected
    }

    // No headers written, no channel leaked
    expect(res.writeHead).not.toHaveBeenCalled()
    expect(group.size).toBe(0)

    // A subsequent valid attachChannel must work cleanly
    const metaSchemaGood = createValidSchema<TestMeta>()
    const group2 = new SSEChannelGroup<any, TestMeta>({
      channelDefaults: { target: 'swr' },
      metaSchema: metaSchemaGood,
    })
    const req2 = createMockRequest('/sse?__restale_cid__=c10b')
    const res2 = createMockResponse()
    const result = group2.attachChannel(req2, res2, { meta: { userId: 'good' } })
    expect(result.channel.state).toBe('open')
    expect(group2.size).toBe(1)
  })

  it('meta validation failure in createChannel does not leave a half-created Response', () => {
    const metaSchema = createInvalidSchema('reject')
    const group = new SSEChannelGroup<any, TestMeta>({
      channelDefaults: { target: 'swr' },
      metaSchema,
    })

    const request = new Request('http://localhost/sse?__restale_cid__=c11')

    let threw = false
    try {
      group.createChannel(request, { meta: { userId: 'bad' } })
    } catch {
      threw = true
    }

    expect(threw).toBe(true)
    expect(group.size).toBe(0)
  })
})

describe('review-findings: buildSSETargetHeaders', () => {
  it('returns all SSE base headers plus target headers for a single target', () => {
    const headers = buildSSETargetHeaders({ target: 'swr' })

    expect(headers).toEqual({
      ...SSE_HEADERS,
      [SSE_RESPONSE_HEADERS.RESTALE_TARGET]: 'swr',
      [SSE_RESPONSE_HEADERS.RESTALE_SUPPORTED]: 'swr',
    })
  })

  it('returns comma-separated supported header for multi-target', () => {
    const headers = buildSSETargetHeaders({ target: ['tanstack-query', 'swr'] })

    expect(headers[SSE_RESPONSE_HEADERS.RESTALE_SUPPORTED]).toBe('tanstack-query, swr')
  })

  it('uses requestedTarget as active target when present', () => {
    const headers = buildSSETargetHeaders({
      target: ['tanstack-query', 'swr'],
      requestedTarget: 'swr',
    })

    expect(headers[SSE_RESPONSE_HEADERS.RESTALE_TARGET]).toBe('swr')
    expect(headers[SSE_RESPONSE_HEADERS.RESTALE_SUPPORTED]).toBe('tanstack-query, swr')
  })

  it('returns empty string for active target when multi-target and no requestedTarget', () => {
    const headers = buildSSETargetHeaders({ target: ['tanstack-query', 'swr'] })

    expect(headers[SSE_RESPONSE_HEADERS.RESTALE_TARGET]).toBe('')
  })

  it('returns empty string for supported header when no target specified', () => {
    const headers = buildSSETargetHeaders({})

    expect(headers[SSE_RESPONSE_HEADERS.RESTALE_SUPPORTED]).toBe('')
    expect(headers[SSE_RESPONSE_HEADERS.RESTALE_TARGET]).toBe('')
  })

  it('includes all SSE base headers (Content-Type, Cache-Control, Connection)', () => {
    const headers = buildSSETargetHeaders({ target: 'swr' })

    expect(headers['Content-Type']).toBe('text/event-stream')
    expect(headers['Cache-Control']).toBe('no-cache')
    expect(headers['Connection']).toBe('keep-alive')
  })

  it('single target defaults activeTarget to that target even without requestedTarget', () => {
    const headers = buildSSETargetHeaders({ target: 'generic' })

    expect(headers[SSE_RESPONSE_HEADERS.RESTALE_TARGET]).toBe('generic')
  })

  it('requestedTarget overrides single-target default', () => {
    const headers = buildSSETargetHeaders({
      target: 'swr',
      requestedTarget: 'swr',
    })

    expect(headers[SSE_RESPONSE_HEADERS.RESTALE_TARGET]).toBe('swr')
  })

  it('preserves order in supported header matching target array order', () => {
    const headers = buildSSETargetHeaders({
      target: ['rtk-query', 'swr', 'tanstack-query'],
    })

    expect(headers[SSE_RESPONSE_HEADERS.RESTALE_SUPPORTED]).toBe('rtk-query, swr, tanstack-query')
  })
})

describe('review-findings: attach/create regression (transport headers via buildSSETargetHeaders)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('attachChannel emits X-ReStale-Target and X-ReStale-Supported headers', () => {
    const group = new SSEChannelGroup({
      channelDefaults: { target: ['swr', 'tanstack-query'] },
    })

    const req = createMockRequest('/sse?__restale_cid__=h1&__restale_target__=swr')
    const res = createMockResponse()

    group.attachChannel(req, res, {})

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'X-ReStale-Target': 'swr',
      'X-ReStale-Supported': 'swr, tanstack-query',
    }))
  })

  it('createChannel response includes correct SSE headers', () => {
    const group = new SSEChannelGroup({
      channelDefaults: { target: 'swr' },
    })

    const request = new Request('http://localhost/sse?__restale_cid__=h2')
    const { response } = group.createChannel(request, {})

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(response.headers.get('X-ReStale-Target')).toBe('swr')
    expect(response.headers.get('X-ReStale-Supported')).toBe('swr')
  })

  it('attachChannel with channel-level target overrides group defaults in headers', () => {
    const group = new SSEChannelGroup({
      channelDefaults: { target: 'swr' },
    })

    const req = createMockRequest('/sse?__restale_cid__=h3')
    const res = createMockResponse()

    group.attachChannel(req, res, { target: 'tanstack-query' })

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'X-ReStale-Target': 'tanstack-query',
      'X-ReStale-Supported': 'tanstack-query',
    }))
  })
})
