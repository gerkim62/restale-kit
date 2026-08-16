import { describe, it, expect } from 'vitest'
import { SSEChannelGroup } from '../core/index.js'

describe('server/hono integration via createFetchResponse', () => {

  it('throws Error synchronously when __restale_cid__ query parameter is missing', () => {
    const group = new SSEChannelGroup({})
    const req = new Request('https://example.com/sse')
    expect(() => group.createFetchResponse(req, {})).toThrow(
      'Missing or invalid __restale_cid__ query parameter in request URL'
    )
  })
})
