/**
 * Gap 11: Capacity/timer/retry inputs are unrestricted numbers
 * 
 * Capacity/timer/retry/deadline inputs are unrestricted number despite being used
 * as discrete bounded values. Affected options include:
 * - capacity
 * - eventBufferCapacity
 * - keepaliveIntervalMs
 * - retryIntervalMs
 * - ttlMs
 * - deadline controls
 * - reconnect delays/retries
 * - HTTP status ranges
 */

import { describe, it, expect } from 'vitest'
import { createSSEChannel } from '@/testing/index.js'
import { createEventStore } from '@/server/core/index.js'
import { SSEChannelGroup } from '@/server/core/index.js'
import { formatRetryFrame, formatRenewFrame } from '@/server/core/framing.js'
import type { SWRSignal } from '@/types/index.js'

describe('Gap 11: Numeric input validation for bounded values', () => {
  describe('EventStore capacity validation', () => {
    it('should reject negative capacity', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: -1 })
      }).toThrow()
    })

    it('should reject fractional capacity', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: 10.5 })
      }).toThrow()
    })

    it('should reject zero capacity', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: 0 })
      }).toThrow()
    })

    it('should reject NaN capacity', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: NaN })
      }).toThrow()
    })

    it('should reject Infinity capacity', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: Infinity })
      }).toThrow()
    })

    it('should reject negative Infinity capacity', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: -Infinity })
      }).toThrow()
    })

    it('should accept valid positive integer capacity', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: 50 })
      }).not.toThrow()
    })

    it('should accept capacity of 1', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: 1 })
      }).not.toThrow()
    })

    it('should accept large capacity values', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: 10000 })
      }).not.toThrow()
    })
  })

  describe('SSEChannel eventBufferCapacity validation', () => {
    it('should reject negative eventBufferCapacity', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          eventBufferCapacity: -1
        })
      }).toThrow()
    })

    it('should reject fractional eventBufferCapacity', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          eventBufferCapacity: 10.7
        })
      }).toThrow()
    })

    it('should reject NaN eventBufferCapacity', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          eventBufferCapacity: NaN
        })
      }).toThrow()
    })

    it('should reject Infinity eventBufferCapacity', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          eventBufferCapacity: Infinity
        })
      }).toThrow()
    })

    it('should accept valid positive integer eventBufferCapacity', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          eventBufferCapacity: 100
        })
      }).not.toThrow()
    })

    it('should accept zero eventBufferCapacity (disabled)', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          eventBufferCapacity: 0
        })
      }).not.toThrow()
    })
  })

  describe('SSEChannelGroup eventBufferCapacity validation', () => {
    it('should reject negative eventBufferCapacity', () => {
      expect(() => {
        new SSEChannelGroup<SWRSignal>({
          eventBufferCapacity: -1
        })
      }).toThrow()
    })

    it('should reject fractional eventBufferCapacity', () => {
      expect(() => {
        new SSEChannelGroup<SWRSignal>({
          eventBufferCapacity: 50.5
        })
      }).toThrow()
    })

    it('should reject NaN eventBufferCapacity', () => {
      expect(() => {
        new SSEChannelGroup<SWRSignal>({
          eventBufferCapacity: NaN
        })
      }).toThrow()
    })

    it('should reject Infinity eventBufferCapacity', () => {
      expect(() => {
        new SSEChannelGroup<SWRSignal>({
          eventBufferCapacity: Infinity
        })
      }).toThrow()
    })

    it('should accept valid positive eventBufferCapacity', () => {
      expect(() => {
        new SSEChannelGroup<SWRSignal>({
          eventBufferCapacity: 100
        })
      }).not.toThrow()
    })
  })

  describe('keepaliveIntervalMs validation', () => {
    it('should reject negative keepaliveIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          keepaliveIntervalMs: -1000
        })
      }).toThrow()
    })

    it('should reject NaN keepaliveIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          keepaliveIntervalMs: NaN
        })
      }).toThrow()
    })

    it('should reject Infinity keepaliveIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          keepaliveIntervalMs: Infinity
        })
      }).toThrow()
    })

    it('should accept valid keepaliveIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          keepaliveIntervalMs: 30000
        })
      }).not.toThrow()
    })

    it('should accept zero keepaliveIntervalMs (disabled)', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          keepaliveIntervalMs: 0
        })
      }).not.toThrow()
    })

    it('should accept fractional keepaliveIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          keepaliveIntervalMs: 1000.5
        })
      }).not.toThrow()
    })
  })

  describe('retryIntervalMs validation', () => {
    it('should reject negative retryIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          retryIntervalMs: -5000
        })
      }).toThrow()
    })

    it('should reject NaN retryIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          retryIntervalMs: NaN
        })
      }).toThrow()
    })

    it('should reject Infinity retryIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          retryIntervalMs: Infinity
        })
      }).toThrow()
    })

    it('should accept valid retryIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          retryIntervalMs: 5000
        })
      }).not.toThrow()
    })

    it('should accept zero retryIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          retryIntervalMs: 0
        })
      }).not.toThrow()
    })
  })

  describe('Framing function numeric validation', () => {
    it('formatRetryFrame should reject NaN', () => {
      expect(() => {
        formatRetryFrame(NaN)
      }).toThrow(/finite/)
    })

    it('formatRetryFrame should reject Infinity', () => {
      expect(() => {
        formatRetryFrame(Infinity)
      }).toThrow(/finite/)
    })

    it('formatRetryFrame should reject negative Infinity', () => {
      expect(() => {
        formatRetryFrame(-Infinity)
      }).toThrow(/finite/)
    })

    it('formatRetryFrame should accept valid finite numbers', () => {
      expect(() => {
        formatRetryFrame(1000)
      }).not.toThrow()
    })

    it('formatRenewFrame should reject NaN maxAttempts', () => {
      expect(() => {
        formatRenewFrame(NaN, 1000)
      }).toThrow(/finite/)
    })

    it('formatRenewFrame should reject Infinity maxAttempts', () => {
      expect(() => {
        formatRenewFrame(Infinity, 1000)
      }).toThrow(/finite/)
    })

    it('formatRenewFrame should reject NaN delayMs', () => {
      expect(() => {
        formatRenewFrame(3, NaN)
      }).toThrow(/finite/)
    })

    it('formatRenewFrame should reject Infinity delayMs', () => {
      expect(() => {
        formatRenewFrame(3, Infinity)
      }).toThrow(/finite/)
    })

    it('formatRenewFrame should accept valid finite numbers', () => {
      expect(() => {
        formatRenewFrame(3, 1000)
      }).not.toThrow()
    })
  })

  describe('Lifetime options validation', () => {
    it('should reject negative ttlMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { ttlMs: -1000 }
        })
      }).toThrow()
    })

    it('should reject NaN ttlMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { ttlMs: NaN }
        })
      }).toThrow()
    })

    it('should reject Infinity ttlMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { ttlMs: Infinity }
        })
      }).toThrow()
    })

    it('should reject fractional ttlMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { ttlMs: 1000.5 }
        })
      }).toThrow()
    })

    it('should accept valid ttlMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { ttlMs: 60000 }
        })
      }).not.toThrow()
    })

    it('should reject negative deadline', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { deadline: -1000 }
        })
      }).toThrow()
    })

    it('should reject NaN deadline', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { deadline: NaN }
        })
      }).toThrow()
    })

    it('should reject Infinity deadline', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { deadline: Infinity }
        })
      }).toThrow()
    })

    it('should reject fractional deadline', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { deadline: Date.now() + 0.5 }
        })
      }).toThrow()
    })

    it('should accept valid deadline', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { deadline: Date.now() + 60000 }
        })
      }).not.toThrow()
    })

    it('should reject both ttlMs and deadline together', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            deadline: Date.now() + 60000
          }
        })
      }).toThrow(/mutually exclusive/i)
    })
  })

  describe('Reconnect options validation', () => {
    it('should reject negative baseDelayMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              baseDelayMs: -1000
            }
          }
        })
      }).toThrow()
    })

    it('should reject NaN baseDelayMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              baseDelayMs: NaN
            }
          }
        })
      }).toThrow()
    })

    it('should reject Infinity baseDelayMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              baseDelayMs: Infinity
            }
          }
        })
      }).toThrow()
    })

    it('should reject negative maxDelayMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              maxDelayMs: -5000
            }
          }
        })
      }).toThrow()
    })

    it('should reject NaN maxDelayMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              maxDelayMs: NaN
            }
          }
        })
      }).toThrow()
    })

    it('should reject negative maxAttempts', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              maxAttempts: -1
            }
          }
        })
      }).toThrow()
    })

    it('should reject NaN maxAttempts', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              maxAttempts: NaN
            }
          }
        })
      }).toThrow()
    })

    it('should reject fractional maxAttempts', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              maxAttempts: 3.5
            }
          }
        })
      }).toThrow()
    })

    it('should accept valid reconnect options', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              baseDelayMs: 1000,
              maxDelayMs: 30000,
              maxAttempts: 5
            }
          }
        })
      }).not.toThrow()
    })

    it('should accept Infinity for maxAttempts (unlimited)', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              maxAttempts: Infinity
            }
          }
        })
      }).not.toThrow()
    })
  })

  describe('HTTP status matcher validation', () => {
    it('should reject negative status code', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: -404
            }
          }
        })
      }).toThrow()
    })

    it('should reject status code below 100', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: 99
            }
          }
        })
      }).toThrow()
    })

    it('should reject status code above 599', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: 600
            }
          }
        })
      }).toThrow()
    })

    it('should reject fractional status code', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: 404.5
            }
          }
        })
      }).toThrow()
    })

    it('should reject NaN status code', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: NaN
            }
          }
        })
      }).toThrow()
    })

    it('should reject Infinity status code', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: Infinity
            }
          }
        })
      }).toThrow()
    })

    it('should accept valid status codes', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: [400, 401, 403, 404]
            }
          }
        })
      }).not.toThrow()
    })

    it('should accept valid status class strings', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: ['4xx', '5xx']
            }
          }
        })
      }).not.toThrow()
    })

    it('should reject inverted range (from > to)', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: { from: 500, to: 400 }
            }
          }
        })
      }).toThrow()
    })

    it('should reject range with negative from', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: { from: -100, to: 200 }
            }
          }
        })
      }).toThrow()
    })

    it('should reject range with NaN', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: { from: NaN, to: 500 }
            }
          }
        })
      }).toThrow()
    })

    it('should accept valid range', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: { from: 400, to: 499 }
            }
          }
        })
      }).not.toThrow()
    })
  })

  describe('Edge cases with very large numbers', () => {
    it('should handle MAX_SAFE_INTEGER for capacity', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: Number.MAX_SAFE_INTEGER })
      }).not.toThrow()
    })

    it('should handle very large keepaliveIntervalMs', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          keepaliveIntervalMs: Number.MAX_SAFE_INTEGER
        })
      }).not.toThrow()
    })

    it('should reject numbers beyond MAX_SAFE_INTEGER that lose precision', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: Number.MAX_SAFE_INTEGER + 1 })
      }).toThrow()
    })
  })

  describe('Zero and boundary value handling', () => {
    it('should accept zero for timer values (disabled)', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          keepaliveIntervalMs: 0,
          retryIntervalMs: 0
        })
      }).not.toThrow()
    })

    it('should accept minimum valid values', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: 1 })
      }).not.toThrow()
      
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: { ttlMs: 1 }
        })
      }).not.toThrow()
    })

    it('should handle status code boundaries correctly', () => {
      expect(() => {
        createSSEChannel<SWRSignal>({
          target: 'swr',
          lifetime: {
            ttlMs: 60000,
            onDeadline: 'reconnect',
            reconnect: {
              nonRetryableStatuses: [100, 599]
            }
          }
        })
      }).not.toThrow()
    })
  })

  describe('Type coercion edge cases', () => {
    it('should reject string coerced to number', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: '10' as any })
      }).toThrow()
    })

    it('should reject boolean coerced to number', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: true as any })
      }).toThrow()
    })

    it('should reject null coerced to number', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: null as any })
      }).toThrow()
    })

    it('should reject undefined for required numeric values', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: undefined })
      }).toThrow()
    })

    it('should reject object coerced to number', () => {
      expect(() => {
        createEventStore<SWRSignal>({ capacity: {} as any })
      }).toThrow()
    })
  })
})
