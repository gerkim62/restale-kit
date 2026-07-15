import { describe, it, expect } from 'vitest'
import { toSSEResponse } from './index.js'

describe('server/hono entrypoint', () => {
  it('creates an SSE Response object from a Hono Request', () => {
    const req = new Request('https://example.com/sse?restaleKitRequestId=hono-789')
    const { response, channel } = toSSEResponse(req)

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(channel.state).toBe('open')
    channel.close()
  })

  it('throws Error synchronously when restaleKitRequestId query parameter is missing', () => {
    const req = new Request('https://example.com/sse')
    expect(() => toSSEResponse(req)).toThrow(
      'Missing or invalid restaleKitRequestId query parameter in request URL'
    )
  })
})
