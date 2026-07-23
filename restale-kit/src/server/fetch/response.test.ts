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

  it('rejects connection on multi-target channel when requestedTarget is absent', async () => {
    const request = new Request('https://example.com/sse?__restale_cid__=conn-fetch-4')
    const { response, channel } = toSSEResponse(request, { target: ['swr', 'tanstack-query'] })

    expect(channel.target).toEqual(['swr', 'tanstack-query'])
    expect(response.headers.get('x-restale-target')).toBe('')

    const reader = channel.stream.getReader()
    await reader.read()
    reader.releaseLock()

    expect(channel.state).toBe('closed')
  })

  it('emits negotiated requested target in X-ReStale-Target response header when target array and requestedTarget are provided', () => {
    const request = new Request(
      'https://example.com/sse?__restale_cid__=conn-fetch-4b&__restale_target__=tanstack-query'
    )
    const { response, channel } = toSSEResponse(request, { target: ['swr', 'tanstack-query'] })

    expect(channel.requestedTarget).toBe('tanstack-query')
    expect(response.headers.get('x-restale-target')).toBe('tanstack-query')
  })

  it('emits X-ReStale-Supported response header with the single supported target', () => {
    const request = new Request('https://example.com/sse?__restale_cid__=conn-fetch-5')
    const { response } = toSSEResponse(request, { target: 'swr' })

    expect(response.headers.get('x-restale-supported')).toBe('swr')
  })

  it('emits comma-separated X-ReStale-Supported response header when target array is provided', () => {
    const request = new Request('https://example.com/sse?__restale_cid__=conn-fetch-6')
    const { response } = toSSEResponse(request, { target: ['tanstack-query', 'swr'] })

    expect(response.headers.get('x-restale-supported')).toBe('tanstack-query, swr')
  })

  it('extracts __restale_target__ from URL and passes requestedTarget to channel', () => {
    const request = new Request(
      'https://example.com/sse?__restale_cid__=conn-fetch-7&__restale_target__=swr'
    )
    const { channel } = toSSEResponse(request, { target: ['swr', 'tanstack-query'] })

    expect(channel.requestedTarget).toBe('swr')
  })

  it('channel state is closed (rejected) when requested target is not in supported set', async () => {
    const request = new Request(
      'https://example.com/sse?__restale_cid__=conn-fetch-8&__restale_target__=rtk-query'
    )
    const { channel } = toSSEResponse(request, { target: ['swr', 'tanstack-query'] })

    // Drain the stream to trigger the start callback
    const reader = channel.stream.getReader()
    await reader.read()
    reader.releaseLock()

    expect(channel.state).toBe('closed')
  })

  it('requestedTarget is undefined when __restale_target__ param is absent', () => {
    const request = new Request('https://example.com/sse?__restale_cid__=conn-fetch-9')
    const { channel } = toSSEResponse(request, { target: 'swr' })

    expect(channel.requestedTarget).toBeUndefined()
  })
})
