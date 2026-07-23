import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { attachSSE } from './attach.js'
import { SSE_HEADERS } from '@/utils/constants.js'

function createMockResponse(): ServerResponse {
  const res = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  }) as unknown as ServerResponse
  res.writeHead = vi.fn()
  return res
}

describe('node attachSSE', () => {
  it('attaches SSE channel to Node req/res, sets headers, and exposes connectionId on channel', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-999',
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    const channel = attachSSE(req, res, { target: 'swr' })

    expect(channel.connectionId).toBe('req-999')
    expect(channel.state).toBe('open')
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      ...SSE_HEADERS,
      'X-ReStale-Target': 'swr',
      'X-ReStale-Supported': 'swr',
    }))
  })

  it('triggers disconnect on request close event', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-888',
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    const channel = attachSSE(req, res, { target: 'swr' })

    req.emit('close')
    expect(channel.state).toBe('closed')
  })

  it('handles fallback when req.url has no query string or is undefined', () => {
    const reqWithoutUrl = Object.assign(new EventEmitter(), {
      url: undefined,
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    expect(() => attachSSE(reqWithoutUrl, res, { target: 'swr' })).toThrow(
      'Missing or invalid __restale_cid__ query parameter in request URL'
    )
  })

  it('emits X-ReStale-Target HTTP header when target option is specified', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-single-target',
      headers: {},
    }) as unknown as IncomingMessage
    const res = createMockResponse()

    const channel = attachSSE(req, res, { target: 'swr' })

    expect(channel.target).toBe('swr')
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'X-ReStale-Target': 'swr',
    }))
  })

  it('rejects connection on multi-target channel when requestedTarget is absent', async () => {
    vi.useFakeTimers()
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-multi-target',
      headers: {},
    }) as unknown as IncomingMessage
    const res = createMockResponse()

    const channel = attachSSE(req, res, { target: ['swr', 'tanstack-query'] })

    expect(channel.target).toEqual(['swr', 'tanstack-query'])
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      ...SSE_HEADERS,
      'X-ReStale-Target': '',
      'X-ReStale-Supported': 'swr, tanstack-query',
    })

    await vi.advanceTimersByTimeAsync(50)
    expect(channel.state).toBe('closed')
    vi.useRealTimers()
  })

  it('emits negotiated requested target in X-ReStale-Target HTTP header when target array and requestedTarget are specified', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-multi-target-req&__restale_target__=tanstack-query',
      headers: {},
    }) as unknown as IncomingMessage
    const res = createMockResponse()

    const channel = attachSSE(req, res, { target: ['swr', 'tanstack-query'] })

    expect(channel.requestedTarget).toBe('tanstack-query')
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      ...SSE_HEADERS,
      'X-ReStale-Target': 'tanstack-query',
      'X-ReStale-Supported': 'swr, tanstack-query',
    })
  })

  it('emits X-ReStale-Supported header with single target', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-supported-single',
      headers: {},
    }) as unknown as IncomingMessage
    const res = createMockResponse()

    attachSSE(req, res, { target: 'swr' })

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'X-ReStale-Supported': 'swr',
    }))
  })

  it('emits comma-separated X-ReStale-Supported header with target array', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-supported-multi',
      headers: {},
    }) as unknown as IncomingMessage
    const res = createMockResponse()

    attachSSE(req, res, { target: ['tanstack-query', 'swr', 'rtk-query'] })

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'X-ReStale-Supported': 'tanstack-query, swr, rtk-query',
    }))
  })

  it('extracts __restale_target__ from URL query param and passes to channel', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-target-extract&__restale_target__=swr',
      headers: {},
    }) as unknown as IncomingMessage
    const res = createMockResponse()

    const channel = attachSSE(req, res, { target: ['swr', 'tanstack-query'] })

    expect(channel.requestedTarget).toBe('swr')
  })

  it('requestedTarget is undefined when __restale_target__ param is absent', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-no-target',
      headers: {},
    }) as unknown as IncomingMessage
    const res = createMockResponse()

    const channel = attachSSE(req, res, { target: 'swr' })

    expect(channel.requestedTarget).toBeUndefined()
  })
})
