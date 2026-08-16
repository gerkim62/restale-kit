import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { internal_attachSSE } from './attach.js'

function createMockResponse(): ServerResponse {
  const res = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  }) as unknown as ServerResponse
  res.writeHead = vi.fn()
  return res
}

describe('node internal_attachSSE', () => {

  it('triggers disconnect on request close event', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-888',
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    const channel = internal_attachSSE(req, res, {})

    req.emit('close')
    expect(channel.state).toBe('closed')
  })

  it('flushes response headers when the runtime supports it', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?__restale_cid__=req-flush',
      headers: {},
    }) as unknown as IncomingMessage
    const res = createMockResponse()
    res.flushHeaders = vi.fn()

    internal_attachSSE(req, res, {})

    expect(res.flushHeaders).toHaveBeenCalledOnce()
  })

  it('handles fallback when req.url has no query string or is undefined', () => {
    const reqWithoutUrl = Object.assign(new EventEmitter(), {
      url: undefined,
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    expect(() => internal_attachSSE(reqWithoutUrl, res, {})).toThrow(
      'Missing or invalid __restale_cid__ query parameter in request URL'
    )
  })
})
