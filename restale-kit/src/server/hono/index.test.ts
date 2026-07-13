import { describe, it, expect } from 'vitest'
import { toSSEResponse as honoToSSEResponse } from './index.js'
import { toSSEResponse as fetchToSSEResponse } from '../fetch/response.js'

describe('server/hono entrypoint', () => {
  it('exports toSSEResponse function matching fetch response implementation', () => {
    expect(honoToSSEResponse).toBeDefined()
    expect(honoToSSEResponse).toBe(fetchToSSEResponse)
  })
})
