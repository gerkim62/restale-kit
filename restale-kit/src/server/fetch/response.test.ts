import { describe, it, expect } from 'vitest'
import { internal_toSSEResponse } from './response.js'

describe('fetch internal_toSSEResponse', () => {

  it('uses explicit options.connectionId over URL searchParams if provided', () => {
    const request = new Request('https://example.com/sse?__restale_cid__=url-cid')
    const { channel } = internal_toSSEResponse(request, { connectionId: 'explicit-cid' })

    expect(channel.connectionId).toBe('explicit-cid')
  })

  it('disconnects channel on request AbortSignal abort', () => {
    const controller = new AbortController()
    const request = new Request('https://example.com/sse?__restale_cid__=conn-fetch-2', {
      signal: controller.signal,
    })

    const { channel } = internal_toSSEResponse(request, {})
    expect(channel.state).toBe('open')

    controller.abort()
    expect(channel.state).toBe('closed')
  })
})
