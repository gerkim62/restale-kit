import { describe, it, expect } from 'vitest'
import { SSEChannelGroup } from '../core/index.js'

describe('server/hono integration via createFetchResponse', () => {
  it('creates an SSE response with auto-generated connection ID', () => {
    const group = new SSEChannelGroup({})
    const req = new Request('https://example.com/sse')
    const result = group.createFetchResponse(req, {})
    try {
      expect(result.response).toBeInstanceOf(Response)
      expect(result.channel.connectionId).toBeDefined()
      expect(typeof result.channel.connectionId).toBe('string')
      expect(result.channel.connectionId.length).toBeGreaterThan(0)
      expect(group.size).toBe(1)
    } finally {
      result.channel.close()
    }
  })
})
