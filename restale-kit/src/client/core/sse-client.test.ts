import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SSEInvalidatorClient } from './sse-client.js'
import { MockEventSource } from '@/test-fixtures/event-source.js'
import { createValidSchema, createInvalidSchema } from '@/test-fixtures/schemas.js'

describe('SSEInvalidatorClient', () => {
  let originalEventSource: typeof globalThis.EventSource

  beforeEach(() => {
    vi.useFakeTimers()
    originalEventSource = globalThis.EventSource
    MockEventSource.clear()
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.EventSource = originalEventSource
  })

  it('passes options and URL with connectionId to EventSource', () => {
    const client = new SSEInvalidatorClient('/sse', { withCredentials: true })
    void client.connect()

    expect(MockEventSource.instances).toHaveLength(1)
    const instance = MockEventSource.instances[0]
    expect(instance.url).toBe(`/sse?restaleKitRequestId=${client.connectionId}`)
    expect(instance.options).toEqual({ withCredentials: true })
  })

  it('returns same pending promise while connecting', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const p1 = client.connect()
    const p2 = client.connect()

    expect(p1).toBe(p2)

    MockEventSource.instances[0]?.emitOpen()
    await expect(p1).resolves.toBeUndefined()
  })

  it('transitions to open status on EventSource open event', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const statusChanges: string[] = []

    client.addEventListener('statuschange', (e: any) => {
      statusChanges.push(e.detail.status)
    })

    const p = client.connect()
    expect(client.status.status).toBe('connecting')

    MockEventSource.instances[0]?.emitOpen()
    await p

    expect(client.status.status).toBe('open')
    expect(statusChanges).toEqual(['connecting', 'open'])
  })

  it('handles errors and auto-reconnects with backoff', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 2, baseDelayMs: 100, jitter: false },
    })

    const p = client.connect()
    p.catch(() => {})
    MockEventSource.instances[0]?.emitError()

    expect(client.status.status).toBe('connecting')

    // Advance timer for 1st retry (attempt 0: 100ms)
    await vi.advanceTimersByTimeAsync(150)
    expect(MockEventSource.instances).toHaveLength(2)

    // 2nd error (attempt 1: 200ms)
    MockEventSource.instances[1]?.emitError()
    await vi.advanceTimersByTimeAsync(250)
    expect(MockEventSource.instances).toHaveLength(3)

    // 3rd error -> exhausted max retries (maxRetries: 2)
    MockEventSource.instances[2]?.emitError()
    expect(client.status.status).toBe('error')
  })

  it('validates incoming SSE invalidate event and updates lastEventId', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const invalidateSpy = vi.fn()

    client.addEventListener('invalidate', (e: any) => {
      invalidateSpy(e.detail)
    })

    const p = client.connect()
    const es = MockEventSource.instances[0]
    es.emitOpen()
    await p

    es.emitCustomEvent('invalidate', JSON.stringify({ key: ['todos'] }), 'evt-100')

    expect(invalidateSpy).toHaveBeenCalledWith({ key: ['todos'] })
    expect(client.lastEventId).toBe('evt-100')
  })

  it('runs optional signalSchema on invalidate event', async () => {
    const schema = createValidSchema((s: any) => ({ key: s.key, action: 'refetch' as const }))
    const client = new SSEInvalidatorClient('/sse', { signalSchema: schema })

    const invalidateSpy = vi.fn()
    client.addEventListener('invalidate', (e: any) => invalidateSpy(e.detail))

    const p = client.connect()
    const es = MockEventSource.instances[0]
    es.emitOpen()
    await p

    es.emitCustomEvent('invalidate', JSON.stringify({ key: ['todos'] }))

    expect(invalidateSpy).toHaveBeenCalledWith({ key: ['todos'], action: 'refetch' })
  })

  it('dispatches error custom event on invalid payload structure', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const errorSpy = vi.fn()
    client.addEventListener('error', errorSpy)

    const p = client.connect()
    const es = MockEventSource.instances[0]
    es.emitOpen()
    await p

    es.emitCustomEvent('invalidate', 'invalid json string')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('closes connection and sets status to closed with reason manual', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const p = client.connect()
    const es = MockEventSource.instances[0]
    es.emitOpen()
    await p

    client.close()

    expect(client.status).toEqual({ status: 'closed', reason: 'manual' })
    expect(es.readyState).toBe(MockEventSource.CLOSED)
  })

  it('clears active retryTimer when disconnect() or close() is called', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 5, baseDelayMs: 1000, jitter: false },
    })

    const p = client.connect()
    p.catch(() => {})

    // Cause connection error so a retry timer is scheduled
    MockEventSource.instances[0]?.emitError()
    expect(client.status.status).toBe('connecting')

    // Calling close clears the scheduled retry timer
    client.close()
    expect(client.status.status).toBe('closed')

    // Reconnecting after disconnect creates new EventSource instance
    void client.connect()
    expect(MockEventSource.instances).toHaveLength(2)
  })
})


