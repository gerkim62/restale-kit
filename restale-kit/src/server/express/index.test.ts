import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { attachSSE } from './index.js'

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

describe('server/express entrypoint', () => {
  it('attaches SSE headers and extracts connectionId from express req/res', () => {
    const req = createMockExpressRequest('/sse?restaleKitRequestId=express-123')
    const res = createMockExpressResponse()

    const { channel, connectionId } = attachSSE(req, res)

    expect(connectionId).toBe('express-123')
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    expect(channel.state).toBe('open')
    channel.close()
  })

  it('throws Error synchronously when restaleKitRequestId is missing', () => {
    const req = createMockExpressRequest('/sse')
    const res = createMockExpressResponse()

    expect(() => attachSSE(req, res)).toThrow(
      'Missing or invalid restaleKitRequestId query parameter in request URL'
    )
  })
})
