import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Server } from 'node:http'
import express from 'express'
import { SSEChannelGroup } from '../core/index.js'
import {
  readStreamUntil,
  closeHttpServer,
} from '@/test-fixtures/http-test-utils.js'

describe('server/express integration via group.handle', () => {
  let server: Server | undefined

  afterEach(async () => {
    await closeHttpServer(server)
    server = undefined
  })

  describe('Real Express HTTP server integration', () => {
    it('streams SSE frames to real Express client with exact headers and receives broadcasts', async () => {
      const app = express()
      const group = new SSEChannelGroup<{ userId: string }>({
        secret: 'express-secret-1234',
        scopeBy: ['userId'],
      })

      app.get('/sse', (req, res) => {
        return group.handle(req, res, { meta: { userId: 'express-user-1' } })
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
      try {
        // Read initial connection frame
        const initialText = await readStreamUntil(reader, (t) => t.includes('event: connected'))
        expect(initialText).toContain(':\n\n')
        expect(initialText).toContain('event: connected\ndata: {"connectionId":')

        // Broadcast invalidation signal
        group.local.broadcast({ key: ['posts', 1] }, true)

        const broadcastText = await readStreamUntil(reader, (t) => t.includes('event: invalidate'))
        expect(broadcastText).toContain('event: invalidate\ndata: {"key":["posts",1]}\n\n')

        abortController.abort()
        await vi.waitFor(
          () => {
            expect(group.local.size).toBe(0)
          },
          { timeout: 1000 },
        )
      } finally {
        await reader.cancel().catch(() => {})
      }
    })

    it('handles client abort and server-side revoke cleanly in Express', async () => {
      const app = express()
      const group = new SSEChannelGroup<{ userId: string }>({
        secret: 'express-secret-5678',
        scopeBy: ['userId'],
      })

      app.get('/sse', (req, res) => {
        return group.handle(req, res, { meta: { userId: 'express-revoke-user' } })
      })

      const port = await new Promise<number>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server!.address()
          resolve(typeof addr === 'object' && addr ? addr.port : 0)
        })
      })

      const res = await fetch(`http://127.0.0.1:${String(port)}/sse`)
      const reader = res.body!.getReader()
      try {
        const initialText = await readStreamUntil(reader, (t) => t.includes('event: connected'))
        expect(initialText).toContain('event: connected')

        group.local.revokeWhere({ userId: 'express-revoke-user' })

        const revokeText = await readStreamUntil(reader, (t) => t.includes('event: revoke'))
        expect(revokeText).toContain('event: revoke')

        const finalChunk = await reader.read()
        expect(finalChunk.done).toBe(true)
        expect(group.local.size).toBe(0)
      } finally {
        await reader.cancel().catch(() => {})
      }
    })
  })
})
