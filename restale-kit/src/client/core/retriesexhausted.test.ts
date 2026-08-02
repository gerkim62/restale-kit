import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { MockEventSource } from '@/test-fixtures/event-source.js'

vi.mock('sse.js', async () => {
  const { MockEventSource: SSE } = await import('@/test-fixtures/event-source.js')
  return { SSE }
})

import { SSEInvalidatorClient } from './sse-client.js'
import { SSE_EVENTS } from '@/utils/constants.js'

describe('retriesexhausted event', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockEventSource.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('emits retriesexhausted event when maxRetries is reached', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: {
        maxRetries: 2,
        baseDelayMs: 10,
        jitter: false,
      },
    })

    const exhaustedSpy = vi.fn()
    client.addEventListener(SSE_EVENTS.RETRIES_EXHAUSTED, exhaustedSpy)

    const connectPromise = client.connect()
    const es1 = MockEventSource.instances[0]
    expect(es1).toBeDefined()

    // Initial connection attempt fails -> schedules retry #1 (10ms delay)
    es1.emitError()
    await vi.advanceTimersByTimeAsync(100)

    // Attempt #1 fails -> schedules retry #2 (20ms delay)
    const es2 = MockEventSource.instances[1]
    expect(es2).toBeDefined()
    es2.emitError()
    await vi.advanceTimersByTimeAsync(100)

    // Attempt #2 fails -> maxRetries (2) reached, retries exhausted
    const es3 = MockEventSource.instances[2]
    expect(es3).toBeDefined()
    es3.emitError()

    await expect(connectPromise).rejects.toThrow()
    expect(exhaustedSpy).toHaveBeenCalledTimes(1)
    expect(exhaustedSpy.mock.calls[0][0].detail).toEqual({
      attempts: 2,
      maxRetries: 2,
    })
  })
})
