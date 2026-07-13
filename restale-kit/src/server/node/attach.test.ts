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
  it('attaches SSE channel to Node req/res and sets headers', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?restaleKitRequestId=req-999',
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    const { channel, connectionId } = attachSSE(req, res)

    expect(connectionId).toBe('req-999')
    expect(channel.state).toBe('open')
    expect(res.writeHead).toHaveBeenCalledWith(200, SSE_HEADERS)
  })

  it('triggers disconnect on request close event', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse?restaleKitRequestId=req-888',
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    const { channel } = attachSSE(req, res)

    req.emit('close')
    expect(channel.state).toBe('closed')
  })
})
