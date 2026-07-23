import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SSEChannelGroup } from '../core/index.js'
import { SSE_HEADERS } from '@/utils/constants.js'

function createMockExpressRequest(url: string): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    url,
    headers: {},
  }) as unknown as IncomingMessage
}

function createMockExpressResponse(): ServerResponse {
  const res = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  }) as unknown as ServerResponse
  res.writeHead = vi.fn()
  return res
}

describe('server/express integration via attachChannel', () => {
  it('attaches SSE headers and exposes connectionId on the returned channel', () => {
    const group = new SSEChannelGroup({})
    const req = createMockExpressRequest('/sse?__restale_cid__=express-123')
    const res = createMockExpressResponse()

    const { channel } = group.attachChannel(req, res, { target: 'swr' })

    expect(channel.connectionId).toBe('express-123')
    expect(SSE_HEADERS).toEqual({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      ...SSE_HEADERS,
      'X-ReStale-Target': 'swr',
      'X-ReStale-Supported': 'swr',
    }))
    expect(channel.state).toBe('open')
    channel.close()
  })

  it('throws Error synchronously when __restale_cid__ is missing', () => {
    const group = new SSEChannelGroup({})
    const req = createMockExpressRequest('/sse')
    const res = createMockExpressResponse()

    expect(() => group.attachChannel(req, res, { target: 'swr' })).toThrow(
      'Missing or invalid __restale_cid__ query parameter in request URL'
    )
  })
})
