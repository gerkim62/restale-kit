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
  it('attaches SSE response with auto-generated connection ID', () => {
    const group = new SSEChannelGroup({})
    const req = createMockExpressRequest('/sse')
    const res = createMockExpressResponse()

    const { channel } = group.attachNodeResponse(req, res, {})
    expect(channel.connectionId).toBeDefined()
    expect(typeof channel.connectionId).toBe('string')
    expect(channel.connectionId.length).toBeGreaterThan(0)
    expect(res.writeHead).toHaveBeenCalledWith(200, SSE_HEADERS)
    expect(group.size).toBe(1)
  })
})
