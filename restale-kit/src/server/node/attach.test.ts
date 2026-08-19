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
      url: '/sse',
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    const channel = internal_attachSSE(req, res, {})

    expect(typeof channel.connectionId).toBe('string')
    expect(channel.connectionId.length).toBeGreaterThan(0)

    req.emit('close')
    expect(channel.state).toBe('closed')
  })

  it('flushes response headers when the runtime supports it', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse',
      headers: {},
    }) as unknown as IncomingMessage
    const res = createMockResponse()
    res.flushHeaders = vi.fn()

    internal_attachSSE(req, res, {})

    expect(res.flushHeaders).toHaveBeenCalledOnce()
  })

  it('handles fallback when req.url is undefined', () => {
    const reqWithoutUrl = Object.assign(new EventEmitter(), {
      url: undefined,
      headers: {},
    }) as unknown as IncomingMessage

    const res = createMockResponse()

    const channel = internal_attachSSE(reqWithoutUrl, res, {})
    expect(typeof channel.connectionId).toBe('string')
    expect(channel.connectionId.length).toBeGreaterThan(0)
  })

  it('respects lastEventId from headers and effective eventStore', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse',
      headers: { 'last-event-id': 'evt-50' },
    }) as unknown as IncomingMessage
    const res = createMockResponse()

    const channel = internal_attachSSE(req, res, { lastEventId: 'custom-id' })
    expect(channel.connectionId).toBeDefined()
  })

  it('invokes hijack method on FastifyReplyLike response object', () => {
    const req = Object.assign(new EventEmitter(), {
      url: '/sse',
      headers: {},
    }) as unknown as IncomingMessage
    const rawRes = createMockResponse()
    const hijackSpy = vi.fn()
    const fastifyReply = {
      raw: rawRes,
      hijack: hijackSpy,
    }

    internal_attachSSE(req, fastifyReply, {})
    expect(hijackSpy).toHaveBeenCalledOnce()
  })
})

