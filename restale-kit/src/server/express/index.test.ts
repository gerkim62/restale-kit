import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import express from 'express'
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

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 1500
): Promise<string> {
  const decoder = new TextDecoder()
  let accumulated = ''
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const { value, done } = await reader.read()
    if (done) break
    accumulated += decoder.decode(value, { stream: true })
    if (predicate(accumulated)) return accumulated
  }
  return accumulated
}

describe('server/express integration via attachNodeResponse', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => {
          resolve()
        })
      })
      server = undefined
    }
  })

  it('attaches SSE response with auto-generated connection ID on mock Express response', () => {
    const group = new SSEChannelGroup({})
    const req = createMockExpressRequest('/sse')
    const res = createMockExpressResponse()

    const { channel } = group.attachNodeResponse(req, res, {})
    try {
      expect(channel.connectionId).toBeDefined()
      expect(typeof channel.connectionId).toBe('string')
      expect(channel.connectionId.length).toBeGreaterThan(0)
      expect(res.writeHead).toHaveBeenCalledWith(200, SSE_HEADERS)
      expect(group.size).toBe(1)
    } finally {
      channel.close()
    }
  })

  describe('Real Express HTTP server integration', () => {
    it('streams SSE frames to real Express client with exact headers and receives broadcasts', async () => {
      const app = express()
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', (req, res) => {
        group.attachNodeResponse(req, res, { meta: { userId: 'express-user-1' } })
      })

      const port = await new Promise<number>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server!.address()
          resolve(typeof addr === 'object' && addr ? addr.port : 0)
        })
      })

      const abortController = new AbortController()
      const res = await fetch(`http://127.0.0.1:${String(port)}/sse`, {
        signal: abortController.signal,
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(res.headers.get('connection')).toBe('keep-alive')

      const reader = res.body!.getReader()

      // Read initial connection frame
      const initialText = await readUntil(reader, (t) => t.includes('event: connected'))
      expect(initialText).toContain(':\n\n')
      expect(initialText).toContain('event: connected\ndata: {"connectionId":')

      // Broadcast invalidation signal
      group.broadcastToAll({ key: ['posts', 1] })

      const broadcastText = await readUntil(reader, (t) => t.includes('event: invalidate'))
      expect(broadcastText).toContain('event: invalidate\ndata: {"key":["posts",1]}\n\n')

      abortController.abort()
      await new Promise((r) => setTimeout(r, 50))
      expect(group.size).toBe(0)
    })

    it('handles client abort and server-side revoke cleanly in Express', async () => {
      const app = express()
      const group = new SSEChannelGroup<{ userId: string }>()

      app.get('/sse', (req, res) => {
        group.attachNodeResponse(req, res, { meta: { userId: 'express-revoke-user' } })
      })

      const port = await new Promise<number>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server!.address()
          resolve(typeof addr === 'object' && addr ? addr.port : 0)
        })
      })

      const res = await fetch(`http://127.0.0.1:${String(port)}/sse`)
      const reader = res.body!.getReader()

      const initialText = await readUntil(reader, (t) => t.includes('event: connected'))
      expect(initialText).toContain('event: connected')

      await group.revokeWhere({ userId: 'express-revoke-user' })

      const revokeText = await readUntil(reader, (t) => t.includes('event: revoke'))
      expect(revokeText).toContain('event: revoke')

      const finalChunk = await reader.read()
      expect(finalChunk.done).toBe(true)
      expect(group.size).toBe(0)
    })
  })
})
