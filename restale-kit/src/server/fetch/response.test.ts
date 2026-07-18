import { describe, it, expect } from 'vitest'
import { toSSEResponse } from './response.js'
import { SSE_HEADERS } from '@/utils/constants.js'

describe('fetch toSSEResponse', () => {
  it('creates SSE Response for Fetch API request and exposes connectionId on channel', () => {
    const request = new Request('https://example.com/sse?__restale_cid__=conn-fetch-1')
    const { response, channel } = toSSEResponse(request, { target: 'swr' })

    expect(channel.connectionId).toBe('conn-fetch-1')
    expect(channel.state).toBe('open')
    expect(response.headers.get('content-type')).toBe(SSE_HEADERS['Content-Type'])
    expect(response.headers.get('cache-control')).toBe(SSE_HEADERS['Cache-Control'])
    expect(response.headers.get('x-restale-target')).toBe('swr')
  })

  it('disconnects channel on request AbortSignal abort', () => {
    const controller = new AbortController()
    const request = new Request('https://example.com/sse?__restale_cid__=conn-fetch-2', {
      signal: controller.signal,
    })

    const { channel } = toSSEResponse(request, { target: 'swr' })
    expect(channel.state).toBe('open')

    controller.abort()
    expect(channel.state).toBe('closed')
  })

  it('emits X-ReStale-Target response header when single target option is provided', () => {
    const request = new Request('https://example.com/sse?__restale_cid__=conn-fetch-3')
    const { response, channel } = toSSEResponse(request, { target: 'swr' })

    expect(channel.target).toBe('swr')
    expect(response.headers.get('x-restale-target')).toBe('swr')
  })

  it('emits comma-separated X-ReStale-Target response header when target array is provided', () => {
    const request = new Request('https://example.com/sse?__restale_cid__=conn-fetch-4')
    const { response, channel } = toSSEResponse(request, { target: ['swr', 'tanstack-query'] })

    expect(channel.target).toEqual(['swr', 'tanstack-query'])
    expect(response.headers.get('x-restale-target')).toBe('swr, tanstack-query')
  })
})
