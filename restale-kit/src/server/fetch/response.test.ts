import { describe, it, expect } from 'vitest'
import { internal_toSSEResponse } from './response.js'

describe('fetch internal_toSSEResponse', () => {
  it('creates an SSE response with auto-generated connection ID', () => {
    const request = new Request('https://example.com/sse')
    const { channel, response } = internal_toSSEResponse(request, {})

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(typeof channel.connectionId).toBe('string')
    expect(channel.connectionId.length).toBeGreaterThan(0)
  })

  it('disconnects channel on request AbortSignal abort', () => {
    const controller = new AbortController()
    const request = new Request('https://example.com/sse', {
      signal: controller.signal,
    })

    const { channel } = internal_toSSEResponse(request, {})
    expect(channel.state).toBe('open')

    controller.abort()
    expect(channel.state).toBe('closed')
  })
})
