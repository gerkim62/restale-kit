import { describe, it, expect, vi, afterEach } from 'vitest'
import { calculateBackoff } from './backoff.js'

describe('calculateBackoff', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calculates exponential backoff without jitter', () => {
    const opts = { jitter: false }
    expect(calculateBackoff(0, opts)).toBe(1000)
    expect(calculateBackoff(1, opts)).toBe(2000)
    expect(calculateBackoff(2, opts)).toBe(4000)
    expect(calculateBackoff(3, opts)).toBe(8000)
  })

  it('caps backoff delay at maxDelayMs', () => {
    const opts = { jitter: false, maxDelayMs: 5000 }
    expect(calculateBackoff(0, opts)).toBe(1000)
    expect(calculateBackoff(3, opts)).toBe(5000) // 8000 capped to 5000
  })

  it('applies jitter range [0.5 * delay, 1.5 * delay]', () => {
    // Math.random() = 0 => factor 0.5
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(calculateBackoff(0, { jitter: true })).toBe(500)

    // Math.random() = 1 => factor 1.5
    vi.spyOn(Math, 'random').mockReturnValue(1)
    expect(calculateBackoff(0, { jitter: true })).toBe(1500)
  })
})
