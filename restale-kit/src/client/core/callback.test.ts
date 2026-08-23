import { describe, it, expect, vi } from 'vitest'
import type { InvalidationHandler } from './client-contracts.js'
import type { Signal } from '@/types/protocol.js'

describe('InvalidationHandler', () => {
  it('accepts standard callback functions', () => {
    const fn = vi.fn()
    const handler: InvalidationHandler = (signal: Signal | Signal[]) => {
      fn(signal)
    }

    const testSignal: Signal = { key: ['api', 'test'] }
    handler(testSignal)
    expect(fn).toHaveBeenCalledWith(testSignal)
  })
})
