import { describe, it, expect } from 'vitest'
import { attachSSE as fastifyAttachSSE } from './index.js'
import { attachSSE as nodeAttachSSE } from '../node/attach.js'

describe('server/fastify entrypoint', () => {
  it('exports attachSSE function matching node transport implementation', () => {
    expect(fastifyAttachSSE).toBeDefined()
    expect(fastifyAttachSSE).toBe(nodeAttachSSE)
  })
})
