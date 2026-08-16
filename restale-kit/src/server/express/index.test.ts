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

describe('server/express integration via attachNodeResponse', () => {

  it('throws Error synchronously when __restale_cid__ is missing', () => {
    const group = new SSEChannelGroup({})
    const req = createMockExpressRequest('/sse')
    const res = createMockExpressResponse()

    expect(() => group.attachNodeResponse(req, res, {})).toThrow(
      'Missing or invalid __restale_cid__ query parameter in request URL'
    )
  })
})
