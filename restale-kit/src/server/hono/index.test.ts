import { describe, it, expect } from 'vitest'
import { toSSEResponse } from './index.js'

describe('server/hono entrypoint', () => {
  it('creates an SSE Response and exposes connectionId on the channel', () => {
    const req = new Request('https://example.com/sse?__restale_cid__=hono-789')
    const { response, channel } = toSSEResponse(req, { target: 'swr' })

    expect(channel.connectionId).toBe('hono-789')
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('x-restale-target')).toBe('swr')
    expect(channel.state).toBe('open')
    channel.close()
  })

  it('throws Error synchronously when __restale_cid__ query parameter is missing', () => {
    const req = new Request('https://example.com/sse')
    expect(() => toSSEResponse(req, { target: 'swr' })).toThrow(
      'Missing or invalid __restale_cid__ query parameter in request URL'
    )
  })
})
