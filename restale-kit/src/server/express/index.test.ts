import { describe, it, expect } from 'vitest'
import { attachSSE as expressAttachSSE } from './index.js'
import { attachSSE as nodeAttachSSE } from '../node/attach.js'

describe('server/express entrypoint', () => {
  it('exports attachSSE function matching node transport implementation', () => {
    expect(expressAttachSSE).toBeDefined()
    expect(expressAttachSSE).toBe(nodeAttachSSE)
  })
})
