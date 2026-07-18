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

    const channel = attachSSE(req, res)

    expect(channel.connectionId).toBe('req-999')
    expect(channel.state).toBe('open')
    expect(res.writeHead).toHaveBeenCalledWith(200, SSE_HEADERS)
  })

  it('triggers disconnect on request close event', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-888',
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    const channel = attachSSE(req, res)

    req.emit('close')
    expect(channel.state).toBe('closed')
  })

  it('handles fallback when req.url has no query string or is undefined', () => {
    const reqWithoutUrl = Object.assign(new EventEmitter(), {
      url: undefined,
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    expect(() => attachSSE(reqWithoutUrl, res)).toThrow(
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
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      ...SSE_HEADERS,
      'X-ReStale-Target': 'swr',
    })
  })

  it('emits comma-separated X-ReStale-Target HTTP header when target array is specified', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-multi-target',
      headers: {},
    }) as unknown as IncomingMessage
    const res = createMockResponse()

    const channel = attachSSE(req, res, { target: ['swr', 'tanstack-query'] })

    expect(channel.target).toEqual(['swr', 'tanstack-query'])
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      ...SSE_HEADERS,
      'X-ReStale-Target': 'swr, tanstack-query',
    })
  })
})
