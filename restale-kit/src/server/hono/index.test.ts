import { describe, it, expect } from 'vitest'
import { SSEChannelGroup } from '../core/index.js'

describe('server/hono integration via group.handle', () => {
  it('creates an SSE response with signed connection ID', async () => {
    const group = new SSEChannelGroup({ secret: 'hono-secret' })
    const req = new Request('https://example.com/sse')
    const response = await group.handle(req)
    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(group.local.size).toBe(1)
    await group.dispose()
  })
})
