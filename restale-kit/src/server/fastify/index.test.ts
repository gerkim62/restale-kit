import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { attachSSE } from './index.js'

function createMockNodeRequest(url: string): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    url,
    headers: {},
  }) as unknown as IncomingMessage
}

function createMockNodeResponse(): ServerResponse {
  const res = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  }) as unknown as ServerResponse
  res.writeHead = vi.fn()
  return res
}

describe('server/fastify entrypoint', () => {
  it('automatically calls reply.hijack() if a Fastify reply object is passed', () => {
    const rawReq = createMockNodeRequest('/sse?restaleKitRequestId=fastify-1')
    const rawRes = createMockNodeResponse()

    const mockRequest = { raw: rawReq }
    const mockReply = { raw: rawRes, hijack: vi.fn() }

    const { channel, connectionId } = attachSSE(mockRequest, mockReply)

    expect(mockReply.hijack).toHaveBeenCalledTimes(1)
    expect(connectionId).toBe('fastify-1')
    expect(channel.state).toBe('open')
    channel.close()
  })

  it('works directly with raw IncomingMessage and ServerResponse', () => {
    const rawReq = createMockNodeRequest('/sse?restaleKitRequestId=fastify-2')
    const rawRes = createMockNodeResponse()

    const { channel, connectionId } = attachSSE(rawReq, rawRes)

    expect(connectionId).toBe('fastify-2')
    expect(channel.state).toBe('open')
    channel.close()
  })
})
