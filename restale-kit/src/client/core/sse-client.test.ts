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
    expect(instance.url).toBe(`/sse?__restale_cid__=${client.connectionId}`)
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

  it('keeps same EventSource instance during native reconnect when readyState is CONNECTING', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const p = client.connect()
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p

    expect(client.status.status).toBe('open')

    // Simulate transient mid-stream error while browser native EventSource is reconnecting (readyState CONNECTING)
    if (es) {
      es.readyState = MockEventSource.CONNECTING
      es.emitError()
    }

    expect(client.status.status).toBe('connecting')
    expect(MockEventSource.instances).toHaveLength(1) // No new instance created

    // Simulate native EventSource completing reconnect
    es?.emitOpen()
    expect(client.status.status).toBe('open')
  })

  it('reuses existing EventSource when connect() is called while readyState is EventSource.CONNECTING', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const p1 = client.connect()
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p1

    expect(client.status.status).toBe('open')

    // Simulate transient mid-stream error while browser native EventSource is reconnecting (readyState CONNECTING)
    if (es) {
      es.readyState = MockEventSource.CONNECTING
      es.emitError()
    }

    expect(client.status.status).toBe('connecting')

    // Calling connect() while native reconnection is active should reuse existing EventSource
    const p2 = client.connect()
    expect(MockEventSource.instances).toHaveLength(1)

    // Simulate native EventSource completing reconnect
    es?.emitOpen()
    await expect(p2).resolves.toBeUndefined()
    expect(client.status.status).toBe('open')
  })

  it('falls back to JS backoff retries when mid-stream error results in readyState CLOSED', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 2, baseDelayMs: 100, jitter: false },
    })

    const p = client.connect()
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p

    // Simulate fatal HTTP 500 mid-stream error where readyState becomes CLOSED
    if (es) {
      es.readyState = MockEventSource.CLOSED
      es.emitError()
    }

    expect(client.status.status).toBe('connecting')

    // JS backoff timer should construct a new EventSource instance
    await vi.advanceTimersByTimeAsync(150)
    expect(MockEventSource.instances).toHaveLength(2)
  })

  it('tears down and sets error status when autoReconnect is false even if readyState is CONNECTING', async () => {
    const client = new SSEInvalidatorClient('/sse', { autoReconnect: false })
    const p = client.connect()
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p

    expect(client.status.status).toBe('open')

    if (es) {
      es.readyState = MockEventSource.CONNECTING
      es.emitError()
    }

    expect(client.status.status).toBe('error')
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it('supports autoReconnect object with { native: false, jsBackoff: true }', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: { native: false, jsBackoff: true },
      reconnect: { maxRetries: 2, baseDelayMs: 100, jitter: false },
    })

    const p = client.connect()
    p.catch(() => {})
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p

    expect(client.status.status).toBe('open')

    // Mid-stream drop with native: false falls through to JS backoff retries
    if (es) {
      es.readyState = MockEventSource.CONNECTING
      es.emitError()
    }

    expect(client.status.status).toBe('connecting')
    await vi.advanceTimersByTimeAsync(150)
    expect(MockEventSource.instances).toHaveLength(2)
  })

  it('supports autoReconnect object with { native: true, jsBackoff: false }', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: { native: true, jsBackoff: false },
    })

    const p = client.connect()
    p.catch(() => {})

    // Initial connection error with jsBackoff: false does NOT retry via JS backoff
    MockEventSource.instances[0]?.emitError()
    expect(client.status.status).toBe('error')
    await vi.advanceTimersByTimeAsync(500)
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it('does not schedule retry if error listener calls close()', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 5, baseDelayMs: 100 },
    })

    client.addEventListener('error', () => {
      client.close()
    })

    const p = client.connect()
    p.catch(() => {})

    MockEventSource.instances[0]?.emitError()

    await vi.advanceTimersByTimeAsync(500)
    // No new instances created because close() replaced/tore down connection in listener
    expect(MockEventSource.instances).toHaveLength(1)
    expect(client.status.status).toBe('closed')
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

  it('closeWithUnmount closes connection and sets status to closed with reason unmount', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const p = client.connect()
    const es = MockEventSource.instances[0]
    es.emitOpen()
    await p

    client.closeWithUnmount()

    expect(client.status).toEqual({ status: 'closed', reason: 'unmount' })
    expect(es.readyState).toBe(MockEventSource.CLOSED)
  })

  it('clears active retryTimer when disconnect() or close() is called', () => {
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

  // --- connect() edge cases: all 6 states from spec table ---

  it('connect() is no-op when already open — returns resolved promise', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    expect(client.status.status).toBe('open')

    // Calling connect() again while open should be a no-op
    const p2 = client.connect()
    await expect(p2).resolves.toBeUndefined()
    // Should NOT have created a new EventSource
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it('connect() from closed-manual creates new EventSource and resets backoff', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 5, baseDelayMs: 100, jitter: false },
    })

    // Open then close
    const p1 = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p1
    client.close()
    expect(client.status).toEqual({ status: 'closed', reason: 'manual' })

    // Connect again — should create new EventSource
    const p2 = client.connect()
    expect(MockEventSource.instances).toHaveLength(2)
    expect(client.status.status).toBe('connecting')

    MockEventSource.instances[1]?.emitOpen()
    await p2
    expect(client.status.status).toBe('open')
  })

  it('connect() from closed-unmount creates new EventSource (allows reuse after re-mount)', async () => {
    // Simulate unmount close by directly testing that connect works from any closed state
    const client = new SSEInvalidatorClient('/sse')

    // Open, close, then connect again
    const p1 = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p1
    client.close()

    // Re-connect from closed state
    void client.connect()
    expect(MockEventSource.instances).toHaveLength(2)
    expect(client.status.status).toBe('connecting')
  })

  it('connect() from error state creates new EventSource and resets backoff', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: false,
    })

    const p = client.connect()
    p.catch(() => {})
    MockEventSource.instances[0]?.emitError()

    // Should be in error state since autoReconnect is false
    expect(client.status.status).toBe('error')

    // connect() from error should create new EventSource
    const p2 = client.connect()
    expect(MockEventSource.instances).toHaveLength(2)
    expect(client.status.status).toBe('connecting')

    MockEventSource.instances[1]?.emitOpen()
    await p2
    expect(client.status.status).toBe('open')
  })

  it('connect() while backing off cancels pending retry and immediately attempts', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 5, baseDelayMs: 5000, jitter: false },
    })

    const p = client.connect()
    p.catch(() => {})

    // First error triggers backoff (5000ms delay)
    MockEventSource.instances[0]?.emitError()
    expect(client.status.status).toBe('connecting')
    expect(MockEventSource.instances).toHaveLength(1) // retry hasn't fired yet

    // Calling connect() while backing off should cancel the retry and immediately attempt
    const p2 = client.connect()
    expect(MockEventSource.instances).toHaveLength(2) // immediate new connection

    MockEventSource.instances[1]?.emitOpen()
    await p2
    expect(client.status.status).toBe('open')

    // Advance time past the old backoff — should NOT create another EventSource
    await vi.advanceTimersByTimeAsync(10000)
    expect(MockEventSource.instances).toHaveLength(2) // no extra connection
  })

  // --- close() rejects pending connect promise ---

  it('close() while connecting rejects the pending connect() promise', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const p = client.connect()

    expect(client.status.status).toBe('connecting')

    client.close()
    await expect(p).rejects.toBeInstanceOf(Event)
  })

  // --- Client validation pipeline ordering ---

  it('emits error event when signalSchema returns async Promise', async () => {
    const asyncSchema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate() {
          return Promise.resolve({ value: { key: ['test'] } })
        },
      },
    }

    const client = new SSEInvalidatorClient('/sse', { signalSchema: asyncSchema })
    const errorSpy = vi.fn()
    client.addEventListener('error', errorSpy)
    const invalidateSpy = vi.fn()
    client.addEventListener('invalidate', invalidateSpy)

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'invalidate',
      JSON.stringify({ key: ['test'] })
    )

    expect(errorSpy).toHaveBeenCalled()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('schema validation runs AFTER structural validation (steps 1-6 before step 7)', async () => {
    const schemaSpy = vi.fn().mockReturnValue({ value: { key: ['test'] } })
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: schemaSpy,
      },
    }

    const client = new SSEInvalidatorClient('/sse', { signalSchema: schema })
    const errorSpy = vi.fn()
    client.addEventListener('error', errorSpy)

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // Send structurally invalid payload (missing key) — should fail at step 3
    // and never reach the schema (step 7)
    MockEventSource.instances[0]?.emitCustomEvent(
      'invalidate',
      JSON.stringify({ notAKey: true })
    )

    expect(errorSpy).toHaveBeenCalled()
    expect(schemaSpy).not.toHaveBeenCalled() // schema was never consulted
  })

  it('handles non-string data payload and missing ErrorEvent constructor during error dispatch', async () => {
    const originalErrorEvent = globalThis.ErrorEvent
    // @ts-expect-error override for test
    delete globalThis.ErrorEvent

    try {
      const client = new SSEInvalidatorClient('/sse')
      const errorSpy = vi.fn()
      client.addEventListener('error', errorSpy)

      const p = client.connect()
      MockEventSource.instances[0]?.emitOpen()
      await p

      // Emit event with non-string data (object)
      MockEventSource.instances[0]?.emitCustomEvent(
        'invalidate',
        { invalidObject: true } as any
      )

      expect(errorSpy).toHaveBeenCalled()
      const errorDetail = errorSpy.mock.calls[0][0].detail
      expect(errorDetail).toBeInstanceOf(Error)
    } finally {
      globalThis.ErrorEvent = originalErrorEvent
    }
  })

  it('validates array batch payload against signalSchema', async () => {
    const schema = createValidSchema((s: any) => ({ key: s.key, action: 'refetch' as const }))
    const client = new SSEInvalidatorClient('/sse', { signalSchema: schema })

    const invalidateSpy = vi.fn()
    client.addEventListener('invalidate', (e: any) => invalidateSpy(e.detail))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'invalidate',
      JSON.stringify([{ key: ['todos'] }, { key: ['users'] }])
    )

    expect(invalidateSpy).toHaveBeenCalledWith([
      { key: ['todos'], action: 'refetch' },
      { key: ['users'], action: 'refetch' },
    ])
  })

  it('rejects initial connectPromise when autoReconnect is false and error occurs', async () => {
    const client = new SSEInvalidatorClient('/sse', { autoReconnect: false })
    const p = client.connect()

    MockEventSource.instances[0]?.emitError()

    await expect(p).rejects.toBeInstanceOf(Event)
  })

  // --- __restale_target__ URL param ---

  it('appends __restale_target__ to EventSource URL when target option is set', () => {
    const client = new SSEInvalidatorClient('/sse', { target: 'swr' })
    void client.connect()

    expect(MockEventSource.instances).toHaveLength(1)
    const url = MockEventSource.instances[0]?.url ?? ''
    expect(url).toContain('__restale_target__=swr')
    expect(url).toContain(`__restale_cid__=${client.connectionId}`)
  })

  it('does NOT append __restale_target__ when target option is not set', () => {
    const client = new SSEInvalidatorClient('/sse')
    void client.connect()

    expect(MockEventSource.instances).toHaveLength(1)
    const url = MockEventSource.instances[0]?.url ?? ''
    expect(url).not.toContain('__restale_target__')
  })

  it('appends __restale_target__ for each supported target value', () => {
    const targets = ['tanstack-query', 'swr', 'rtk-query', 'generic'] as const
    for (const target of targets) {
      MockEventSource.clear()
      const client = new SSEInvalidatorClient('/sse', { target })
      void client.connect()
      const url = MockEventSource.instances[0]?.url ?? ''
      expect(url).toContain(`__restale_target__=${target}`)
    }
  })

  // --- revoke event with richer detail ---

  it('dispatches revoke CustomEvent with reason/requested/supported on unsupported-target revoke', async () => {
    const client = new SSEInvalidatorClient('/sse', { target: 'rtk-query' })
    const revokeSpy = vi.fn()
    client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

    const p = client.connect()
    p.catch(() => {})
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p

    const payload = JSON.stringify({
      reason: 'unsupported-target',
      requested: 'rtk-query',
      supported: ['tanstack-query', 'swr'],
    })
    es?.emitCustomEvent('revoke', payload)

    expect(revokeSpy).toHaveBeenCalledWith({
      reason: 'unsupported-target',
      requested: 'rtk-query',
      supported: ['tanstack-query', 'swr'],
    })
  })

  it('sets status to { status: closed, reason: revoked } and suppresses retry on unsupported-target revoke', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      target: 'rtk-query',
      autoReconnect: true,
      reconnect: { maxRetries: 5, baseDelayMs: 100, jitter: false },
    })

    const p = client.connect()
    p.catch(() => {})
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p

    const payload = JSON.stringify({
      reason: 'unsupported-target',
      requested: 'rtk-query',
      supported: ['swr'],
    })
    es?.emitCustomEvent('revoke', payload)

    expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })

    // Advance timers — no retry should occur
    await vi.advanceTimersByTimeAsync(1000)
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it('dispatches revoke event with only reason field when no details present (backward compat)', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const revokeSpy = vi.fn()
    client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

    const p = client.connect()
    p.catch(() => {})
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p

    es?.emitCustomEvent('revoke', JSON.stringify({ reason: 'logout' }))

    // The detail matches the non-unsupported-target branch: only reason is present
    expect(revokeSpy).toHaveBeenCalledWith({ reason: 'logout' })
  })

  it('dispatches revoke event with undefined reason on malformed payload', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const revokeSpy = vi.fn()
    client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

    const p = client.connect()
    p.catch(() => {})
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p

    es?.emitCustomEvent('revoke', 'not-json')

    expect(revokeSpy).toHaveBeenCalledWith({ reason: undefined })
  })

  it('onopen fires before revoke arrives — ordering is open then revoke', async () => {
    const client = new SSEInvalidatorClient('/sse', { target: 'rtk-query' })
    const events: string[] = []

    client.addEventListener('statuschange', (e) => {
      events.push(`statuschange:${(e.detail as { status: string }).status}`)
    })
    client.addEventListener('revoke', () => {
      events.push('revoke')
    })

    const p = client.connect()
    p.catch(() => {})
    const es = MockEventSource.instances[0]

    // onopen fires first
    es?.emitOpen()
    await p

    // revoke arrives after open
    es?.emitCustomEvent(
      'revoke',
      JSON.stringify({ reason: 'unsupported-target', requested: 'rtk-query', supported: ['swr'] })
    )

    // Status sequence: connecting → open → closed (revoked)
    expect(events).toEqual(['statuschange:connecting', 'statuschange:open', 'statuschange:closed', 'revoke'])
  })

  it('partial unsupported-target frame (missing requested/supported) falls to generic branch', async () => {
    // If server sends reason:'unsupported-target' but omits requested/supported fields,
    // the client must NOT emit the structured first branch (which requires all three fields).
    // It must fall through to the generic branch: { reason: 'unsupported-target' } is
    // NOT possible in the type — but at runtime it would be a plain string. The guard in
    // wireInvalidateListener requires parsedRequested !== undefined && parsedSupported !== undefined
    // before emitting the first branch, so this should dispatch { reason: undefined } when
    // those fields are absent.
    const client = new SSEInvalidatorClient('/sse')
    const revokeSpy = vi.fn()
    client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

    const p = client.connect()
    p.catch(() => {})
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p

    // Frame has reason but is missing required requested+supported
    es?.emitCustomEvent('revoke', JSON.stringify({ reason: 'unsupported-target' }))

    // Must fall to generic branch because parsedSupported is undefined
    expect(revokeSpy).toHaveBeenCalledWith({ reason: 'unsupported-target' })
    expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })
  })
})



// ─── renew frame tests ────────────────────────────────────────────────────────

describe('SSEInvalidatorClient — renew frame', () => {
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

  it('emits a renew CustomEvent with the frame payload when renew is received', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const renewSpy = vi.fn()
    client.addEventListener('renew', (e: any) => renewSpy(e.detail))

    const p = client.connect()
    const es = MockEventSource.instances[0]
    es?.emitOpen()
    await p

    es?.emitCustomEvent('renew', JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 }))

    expect(renewSpy).toHaveBeenCalledWith({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
  })

  it('transitions to connecting then open on a successful renew reconnect', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const statuses: string[] = []
    client.addEventListener('statuschange', (e: any) => statuses.push(e.detail.status))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )

    expect(client.status.status).toBe('connecting')

    // The renew handler creates a new EventSource immediately (first attempt, no delay)
    expect(MockEventSource.instances).toHaveLength(2)
    MockEventSource.instances[1]?.emitOpen()

    expect(client.status.status).toBe('open')
    expect(statuses).toContain('connecting')
    expect(statuses).toContain('open')
  })

  it('does NOT consume the general maxRetries budget (renew budget is separate)', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 1, baseDelayMs: 100, jitter: false },
    })

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // Receive renew with maxAttempts: 1
    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )

    // Confirmatory attempt fails
    MockEventSource.instances[1]?.emitError()

    // Should be closed/revoked — NOT retried via the general backoff path
    expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })

    // Advance time — no extra connection should be created
    await vi.advanceTimersByTimeAsync(1000)
    expect(MockEventSource.instances).toHaveLength(2)
  })

  it('emits revoke event with reason deadline when renew exhausts maxAttempts', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const revokeSpy = vi.fn()
    client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )

    // Confirmatory attempt fails
    MockEventSource.instances[1]?.emitError()

    expect(revokeSpy).toHaveBeenCalledWith({ reason: 'deadline' })
    expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })
  })

  it('maxAttempts: 2 — makes second attempt after retryDelayMs when first fails', async () => {
    const client = new SSEInvalidatorClient('/sse')

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 2, retryDelayMs: 500 })
    )

    // First attempt is immediate — fails
    expect(MockEventSource.instances).toHaveLength(2)
    MockEventSource.instances[1]?.emitError()

    // Second attempt is delayed by retryDelayMs ± jitter
    expect(MockEventSource.instances).toHaveLength(2) // not yet
    await vi.advanceTimersByTimeAsync(700) // past max jitter window
    expect(MockEventSource.instances).toHaveLength(3)

    // Second attempt succeeds
    MockEventSource.instances[2]?.emitOpen()
    expect(client.status.status).toBe('open')
  })

  it('successful renew reconnect clears renewing flag — subsequent network drops use normal backoff', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 3, baseDelayMs: 100, jitter: false },
    })

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // Receive renew and successfully reconnect
    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )
    MockEventSource.instances[1]?.emitOpen()
    expect(client.status.status).toBe('open')

    // Now simulate a regular network error on the new connection
    if (MockEventSource.instances[1]) {
      MockEventSource.instances[1].readyState = MockEventSource.CLOSED
      MockEventSource.instances[1].emitError()
    }

    // Should enter normal JS backoff reconnect (not be treated as revoked)
    expect(client.status.status).toBe('connecting')
    await vi.advanceTimersByTimeAsync(150)
    expect(MockEventSource.instances).toHaveLength(3)
  })

  it('uses default maxAttempts and retryDelayMs from FRAME_GUARD_DEFAULTS on malformed renew payload', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const renewSpy = vi.fn()
    client.addEventListener('renew', (e: any) => renewSpy(e.detail))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // Send malformed payload — should fall back to defaults
    MockEventSource.instances[0]?.emitCustomEvent('renew', 'not-json')

    expect(renewSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )
    // Attempt was made immediately
    expect(MockEventSource.instances).toHaveLength(2)
  })

  it('renew does not fire onerror general backoff when renew reconnect is in progress', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 5, baseDelayMs: 100, jitter: false },
    })

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )

    // The original ES fires onerror (as it closes) — this must NOT start a general backoff
    MockEventSource.instances[0]?.emitError()

    // Only the renew attempt should exist, not an extra backoff attempt
    await vi.advanceTimersByTimeAsync(500)
    // 2 instances: original + 1 renew attempt
    expect(MockEventSource.instances.length).toBeLessThanOrEqual(2)
  })
})
