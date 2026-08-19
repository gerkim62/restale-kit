import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { internal_attachSSE } from './attach.js'

import { createEventStore } from '@/server/core/event-store.js'

function createMockResponse(): ServerResponse & { writtenChunks: string[] } {
  const writtenChunks: string[] = []
  const res = new Writable({
    write(chunk, _encoding, callback) {
      writtenChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      callback()
    },
  }) as unknown as ServerResponse & { writtenChunks: string[] }
  res.writtenChunks = writtenChunks
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

  it('replays missed events from group eventStore using last-event-id header', async () => {
    const eventStore = createEventStore()
    eventStore.add({ key: ['todos', 1] }, 'evt-1')
    eventStore.add({ key: ['todos', 2] }, 'evt-2')

    const req = Object.assign(new EventEmitter(), {
      url: '/sse',
      headers: { 'last-event-id': 'evt-1' },
    }) as unknown as IncomingMessage
    const res = createMockResponse()

    const channel = internal_attachSSE(req, res, {}, { eventStore, channelDefaults: undefined })
    expect(channel.connectionId).toBeDefined()

    // Wait for the readable stream to pipe into the writable mock response
    await new Promise((resolve) => setImmediate(resolve))

    const output = res.writtenChunks.join('')
    expect(output).toContain('id: evt-2\nevent: invalidate\ndata: {"key":["todos",2]}\n\n')
    channel.close()
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

