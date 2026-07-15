import { describe, it, expect } from 'vitest'
import { toSSEResponse } from './response.js'
import { SSE_HEADERS } from '@/utils/constants.js'

describe('fetch toSSEResponse', () => {
  it('creates SSE Response for Fetch API request and exposes connectionId on channel', () => {
    const request = new Request('https://example.com/sse?restaleKitRequestId=conn-fetch-1')
    const { response, channel } = toSSEResponse(request)

    expect(channel.connectionId).toBe('conn-fetch-1')
    expect(channel.state).toBe('open')
    expect(response.headers.get('content-type')).toBe(SSE_HEADERS['Content-Type'])
    expect(response.headers.get('cache-control')).toBe(SSE_HEADERS['Cache-Control'])
  })

  it('disconnects channel on request AbortSignal abort', () => {
    const controller = new AbortController()
    const request = new Request('https://example.com/sse?restaleKitRequestId=conn-fetch-2', {
      signal: controller.signal,
    })

    const { channel } = toSSEResponse(request)
    expect(channel.state).toBe('open')

    controller.abort()
    expect(channel.state).toBe('closed')
  })
})
