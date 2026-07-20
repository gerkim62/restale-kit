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

  it('malformed renew payload (not-json) is treated as a hard revoke — no confirmatory attempt', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const renewSpy = vi.fn()
    const revokeSpy = vi.fn()
    client.addEventListener('renew', (e: any) => renewSpy(e.detail))
    client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // Malformed payload — cannot extract a valid maxAttempts, so no attempt is made
    MockEventSource.instances[0]?.emitCustomEvent('renew', 'not-json')

    // renew event must NOT be emitted (there is no valid frame to report)
    expect(renewSpy).not.toHaveBeenCalled()
    // Treated as hard revoke
    expect(revokeSpy).toHaveBeenCalledWith({ reason: 'deadline' })
    expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })
    // No confirmatory EventSource created
    expect(MockEventSource.instances).toHaveLength(1)
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


// ─── frameguard-spec(7) — missing / corrected / strengthened tests ────────────
//
// Each describe block maps to a specific spec section. Comments cite the exact
// clause being exercised and explain why the test is expected to fail (or
// exposes a gap) against the current implementation.

describe('frameguard-spec §4.1.2 — renew frame: maxAttempts is server-supplied, client holds no default', () => {
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

  // SPEC: "The client holds no independent default and performs no local override —
  // maxAttempts is read from the frame the server sent for that deadline hit, full stop."
  //
  // The implementation treats a missing maxAttempts as a malformed payload (parseOk=false)
  // and falls to the hard-revoke path — no renew event is emitted, no confirmatory attempt
  // is made, and the connection closes with { reason: 'deadline' }.
  // This test verifies that spec-correct behaviour: no second EventSource created.
  it('renew frame with missing maxAttempts triggers hard revoke (no confirmatory attempt)', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const revokeSpy = vi.fn()
    client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // Payload deliberately omits maxAttempts — spec says client must not invent a value.
    // Implementation guard: `typeof ma === 'number' && Number.isFinite(ma) && ma >= 1`
    // fails for undefined → parseOk stays false → hard-revoke path, zero confirmatory attempts.
    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', retryDelayMs: 250 })
    )

    // No new EventSource should have been created — hard-revoke path, no reconnect attempt.
    expect(MockEventSource.instances).toHaveLength(1)
  })

  // SPEC: same clause — retryDelayMs is also server-supplied.
  // A payload with maxAttempts present but retryDelayMs absent is valid:
  // §4.1.5 says "retryDelayMs is irrelevant and may be omitted when maxAttempts is 1."
  // For maxAttempts > 1 with retryDelayMs absent, the implementation uses 0 as a neutral
  // default (no invented constant from FRAME_GUARD_DEFAULTS). With delay=0, the second
  // attempt fires immediately after the first fails.
  it('renew frame with missing retryDelayMs uses 0 delay (not the FRAME_GUARD_DEFAULTS constant)', async () => {
    const client = new SSEInvalidatorClient('/sse')

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // maxAttempts=2 but retryDelayMs is absent — client must not substitute 250ms from constants
    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 2 })
    )

    // First attempt is immediate
    expect(MockEventSource.instances).toHaveLength(2)
    MockEventSource.instances[1]?.emitError()

    // With retryDelayMs defaulting to 0, the delay is setTimeout(..., 0) — fires after
    // a microtask tick. Advance by 0ms to flush it.
    await vi.advanceTimersByTimeAsync(0)

    // Third instance must exist now — delay was 0ms, not 250ms from FRAME_GUARD_DEFAULTS
    expect(MockEventSource.instances).toHaveLength(3)
  })

  // The implementation now treats a malformed renew payload as a hard revoke and does
  // NOT emit the renew event at all (there is no valid frame to report). This test
  // documents that contract and verifies it doesn't accidentally emit renew with fabricated data.
  it('renew CustomEvent is NOT emitted when payload is malformed — only revoke fires', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const renewSpy = vi.fn()
    const revokeSpy = vi.fn()
    client.addEventListener('renew', (e: any) => renewSpy(e.detail))
    client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent('renew', 'not-json')

    // renew event must NOT fire (no valid frame data to surface)
    expect(renewSpy).not.toHaveBeenCalled()
    // revoke fires with reason:'deadline' per the hard-revoke path
    expect(revokeSpy).toHaveBeenCalledWith({ reason: 'deadline' })
    expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })
  })

  // SPEC: §4.1.3 — renew exhaustion should not reduce remaining maxRetries budget.
  // After a renew cycle completes (success or failure), the general backoff attempt
  // counter must be exactly as it was before the renew frame arrived.
  //
  // The implementation correctly rejects maxAttempts: 0 as malformed — the guard
  // `ma >= 1` fails, parseOk stays false, and the connection closes via hard-revoke
  // with no confirmatory attempt. This is spec-correct: a server sending maxAttempts: 0
  // is effectively saying "don't reconnect", and the client honours that.
  it('renew frame with maxAttempts: 0 triggers hard revoke (floor of 0 is protocol error)', async () => {
    const client = new SSEInvalidatorClient('/sse')

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 0, retryDelayMs: 250 })
    )

    // Implementation rejects ma < 1 entirely (parseOk=false → hard-revoke path).
    // No confirmatory EventSource should be created.
    expect(MockEventSource.instances).toHaveLength(1)
  })
})

describe('frameguard-spec §4.1.3 — retry-budget isolation: renew attempts never touch maxRetries counter', () => {
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

  // SPEC: §4.1.3 — renew exhaustion should not reduce remaining maxRetries budget.
  // After a renew cycle completes (success or failure), the general backoff attempt
  // counter must be exactly as it was before the renew frame arrived.
  //
  // CURRENT BEHAVIOUR: the implementation does NOT reset or restore `this.attempt`
  // after a failed renew sequence. After renew exhaustion the status is 'closed/revoked'
  // so the budget question is moot for that connection — but this test verifies that
  // a *successful* renew reconnect correctly resets the attempt counter to 0.
  it('successful renew reconnect resets attempt counter so full maxRetries budget is available', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 2, baseDelayMs: 100, jitter: false },
    })

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // Trigger one ordinary retry to consume attempt slot 0
    if (MockEventSource.instances[0]) {
      MockEventSource.instances[0].readyState = MockEventSource.CLOSED
      MockEventSource.instances[0].emitError()
    }
    await vi.advanceTimersByTimeAsync(150)
    // attempt is now 1 internally; maxRetries=2 so 1 slot remains
    MockEventSource.instances[1]?.emitOpen()

    // Now receive renew — successful confirmatory reconnect
    MockEventSource.instances[1]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )
    MockEventSource.instances[2]?.emitOpen()
    expect(client.status.status).toBe('open')

    // After successful renew, attempt counter must be 0 (reset on open).
    // Drop the connection — should get full maxRetries=2 attempts, not maxRetries - 1
    if (MockEventSource.instances[2]) {
      MockEventSource.instances[2].readyState = MockEventSource.CLOSED
      MockEventSource.instances[2].emitError()
    }
    await vi.advanceTimersByTimeAsync(150)
    expect(MockEventSource.instances).toHaveLength(4) // attempt 1 after renew success
    MockEventSource.instances[3]?.emitError()
    await vi.advanceTimersByTimeAsync(250)
    expect(MockEventSource.instances).toHaveLength(5) // attempt 2
    MockEventSource.instances[4]?.emitError()
    // Now exhausted
    expect(client.status.status).toBe('error')
  })

  // SPEC: §4.1.3 — "a connection whose session is genuinely dead gets retried the
  // same number of times a flaky network connection would — hammering the server"
  // — the spec says this MUST NOT happen. Renew exhaustion → closed/revoked,
  // the general backoff loop must not fire afterwards regardless of maxRetries.
  //
  // The existing test checks instance count at t=1000ms but uses a weak assertion
  // (toHaveLength(2)). This stronger version also verifies client.status.
  it('after renew exhaustion the general backoff loop is completely suppressed', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 5, baseDelayMs: 50, jitter: false },
    })

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )

    // Confirmatory attempt fails
    MockEventSource.instances[1]?.emitError()

    expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })

    // Advance 2000ms to flush any lingering timers and confirm no further connections
    // are created by the general backoff loop (which is suppressed after renew exhaustion).
    await vi.advanceTimersByTimeAsync(2000)

    // Strictly 2 — original + 1 confirmatory. Any more means the general loop fired.
    expect(MockEventSource.instances).toHaveLength(2)
  })

  // SPEC: §4.1.3 — the onerror that fires on the *original* ES when the server closes
  // it after sending renew must not start a general backoff cycle.
  // The existing test uses `toBeLessThanOrEqual(2)` which could pass with 1 instance
  // (meaning no confirmatory attempt was made at all — equally wrong).
  it('onerror on original ES during renew produces exactly one new ES (the confirmatory attempt)', async () => {
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

    // The server closes the original stream — onerror fires on it
    MockEventSource.instances[0]?.emitError()

    // Still exactly 2: original + 1 renew attempt
    await vi.advanceTimersByTimeAsync(500)
    expect(MockEventSource.instances).toHaveLength(2)
  })
})

describe('frameguard-spec §4.1.5 — jitter bounds on confirmatory attempt spacing', () => {
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

  // SPEC §4.1.5: "client applies a small jitter window (e.g. ±20%) around the
  // server-supplied retryDelayMs for each spaced attempt"
  // RENEW_JITTER_FACTOR = 0.2, so for retryDelayMs=500 the window is [400, 600].
  //
  // This test verifies the LOWER bound: the second attempt must NOT fire before
  // retryDelayMs * (1 - RENEW_JITTER_FACTOR) = 400 ms.
  it('second confirmatory attempt does not fire before retryDelayMs*(1-jitter) floor', async () => {
    const client = new SSEInvalidatorClient('/sse')

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 2, retryDelayMs: 500 })
    )

    // First attempt is immediate
    expect(MockEventSource.instances).toHaveLength(2)
    MockEventSource.instances[1]?.emitError()

    // Advance to just under the jitter floor (400ms - 1ms)
    await vi.advanceTimersByTimeAsync(399)
    // Must NOT have fired yet — anything earlier violates the lower jitter bound
    expect(MockEventSource.instances).toHaveLength(2)
  })

  // SPEC §4.1.5: upper bound — the second attempt must fire within
  // retryDelayMs * (1 + RENEW_JITTER_FACTOR) = 600 ms.
  it('second confirmatory attempt fires within retryDelayMs*(1+jitter) ceiling', async () => {
    const client = new SSEInvalidatorClient('/sse')

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 2, retryDelayMs: 500 })
    )

    expect(MockEventSource.instances).toHaveLength(2)
    MockEventSource.instances[1]?.emitError()

    // Advance past the jitter ceiling (600ms + small buffer)
    await vi.advanceTimersByTimeAsync(650)
    // Must have fired by now
    expect(MockEventSource.instances).toHaveLength(3)
  })

  // SPEC §4.1.5: "Fixed delay, not exponential backoff."
  // For maxAttempts=3, retryDelayMs=200:
  //   - 1st attempt: immediate
  //   - 2nd attempt: ~200ms after 1st fails (within ±20% jitter: [160, 240])
  //   - 3rd attempt: ~200ms after 2nd fails (within ±20% jitter: [160, 240])
  // The delay must NOT grow (no doubling). This test verifies the 3rd attempt
  // does not need an exponentially larger wait.
  it('delay between attempts is flat (not exponential) — third attempt still within one jitter window', async () => {
    const client = new SSEInvalidatorClient('/sse')

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 3, retryDelayMs: 200 })
    )

    // 1st attempt: immediate
    expect(MockEventSource.instances).toHaveLength(2)
    MockEventSource.instances[1]?.emitError()

    // Advance past 1st delay ceiling (200 * 1.2 = 240ms + buffer)
    await vi.advanceTimersByTimeAsync(260)
    expect(MockEventSource.instances).toHaveLength(3) // 2nd attempt arrived

    MockEventSource.instances[2]?.emitError()

    // Advance another flat window for 3rd attempt — should NOT require 400ms (2x base)
    await vi.advanceTimersByTimeAsync(260)
    expect(MockEventSource.instances).toHaveLength(4) // 3rd attempt arrived
  })
})

describe('frameguard-spec §4.1.2 — renew event fires BEFORE the first confirmatory attempt', () => {
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

  // SPEC §4.1.2: "This event fires once, at the moment the renew frame is received,
  // before any reconnect attempt begins."
  // The implementation does dispatch before calling attemptRenewReconnect() — but
  // this test makes the ordering observable and will catch any refactor that breaks it.
  it('renew CustomEvent is dispatched synchronously before a new EventSource is created', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const order: string[] = []

    client.addEventListener('renew', () => {
      order.push(`renew:instances=${MockEventSource.instances.length}`)
    })

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )

    // renew event must have fired when there was still only 1 instance
    expect(order).toEqual(['renew:instances=1'])
    // and the new ES was created afterwards (synchronously as part of the same handler)
    expect(MockEventSource.instances).toHaveLength(2)
  })

  // SPEC: status transitions during renew are 'connecting' → (attempt) → 'open'/'revoked'.
  // Specifically: status must be 'connecting' at the moment the renew event fires,
  // not 'open' (which would mean the status update came too late).
  it('status is connecting at the moment the renew CustomEvent fires', async () => {
    const client = new SSEInvalidatorClient('/sse')
    let statusAtRenew: string | undefined

    client.addEventListener('renew', () => {
      statusAtRenew = client.status.status
    })

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )

    expect(statusAtRenew).toBe('connecting')
  })
})

describe('frameguard-spec §4.1.5 — retryDelayMs is irrelevant and must be ignored when maxAttempts is 1', () => {
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

  // SPEC §4.1.5: "retryDelayMs is irrelevant and may be omitted when maxAttempts is 1."
  // When maxAttempts=1, the single attempt is immediate regardless of retryDelayMs.
  // The implementation only uses retryDelayMs when attemptsRemaining > 0 after a failure,
  // so this should hold — but we make it explicit.
  it('with maxAttempts=1 the single attempt is immediate even if retryDelayMs is huge', async () => {
    const client = new SSEInvalidatorClient('/sse')

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 999999 })
    )

    // First (and only) attempt must be immediate — no timer should be involved
    expect(MockEventSource.instances).toHaveLength(2)
  })

  // Complement: with maxAttempts=1, after failure NO timer is scheduled (no delay
  // before the revoke path fires — it should be immediate exhaustion).
  it('with maxAttempts=1 failure leads to immediate revoke path with no timer', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const revokeSpy = vi.fn()
    client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 999999 })
    )

    // Fail the confirmatory attempt — revoke should fire synchronously, before any timer
    MockEventSource.instances[1]?.emitError()

    // No timer advance needed — revoke was immediate
    expect(revokeSpy).toHaveBeenCalledWith({ reason: 'deadline' })
    expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })

    // Advance past retryDelayMs to prove no timer was pending
    await vi.advanceTimersByTimeAsync(1_100_000)
    expect(MockEventSource.instances).toHaveLength(2)
  })
})

describe('frameguard-spec §4.1.2 — renew is distinct from onerror path: does not consume maxRetries', () => {
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

  // SPEC: "it does not fall into the shared jsBackoffAutoReconnect loop or consume
  // the connection's maxRetries budget"
  //
  // This is a stricter version of the existing test. After a renew cycle completes
  // successfully, the next ordinary network drop must still get the FULL maxRetries
  // budget (not maxRetries - 1 because a renew attempt secretly used one slot).
  //
  // CURRENT BEHAVIOUR: renew success wires wireRenewSuccess which calls
  // this.attempt = 0, so this should pass — but the test makes it explicit and
  // will catch any regression.
  it('renew confirmatory attempt does not decrement the maxRetries slot count', async () => {
    const client = new SSEInvalidatorClient('/sse', {
      autoReconnect: true,
      reconnect: { maxRetries: 1, baseDelayMs: 100, jitter: false },
    })

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // Renew succeeds — should not have consumed the maxRetries=1 slot
    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )
    MockEventSource.instances[1]?.emitOpen()
    expect(client.status.status).toBe('open')

    // Now a genuine network drop — should still get maxRetries=1 attempt
    if (MockEventSource.instances[1]) {
      MockEventSource.instances[1].readyState = MockEventSource.CLOSED
      MockEventSource.instances[1].emitError()
    }
    expect(client.status.status).toBe('connecting') // backoff timer pending
    await vi.advanceTimersByTimeAsync(150)
    expect(MockEventSource.instances).toHaveLength(3) // retry happened
  })
})

describe('frameguard-spec §4.1.2 — close() during active renew sequence', () => {
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

  // NOT in the spec explicitly, but required by the existing close() contract
  // (manual close always wins) plus teardown() clears renewRetryTimer.
  //
  // CURRENT BEHAVIOUR: teardown() nulls renewRetryTimer and closes the ES.
  // But wireRenewSuccess is registered as onopen on the new ES — if the new ES
  // is torn down before it opens, onerror fires which calls onRenewError.
  // onRenewError calls `if (this.eventSource === null) return` — so it should
  // short-circuit. This test verifies the whole sequence doesn't escape.
  it('close() during renew cancels confirmatory attempt and yields closed/manual', async () => {
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

    // Confirmatory attempt is in-flight (connecting)
    expect(MockEventSource.instances).toHaveLength(2)
    expect(client.status.status).toBe('connecting')

    // User manually closes the connection mid-renew
    client.close()

    expect(client.status).toEqual({ status: 'closed', reason: 'manual' })
    // revoke must NOT have fired — this was a user-initiated close, not session death
    expect(revokeSpy).not.toHaveBeenCalled()

    // The confirmatory ES fires onerror as it's torn down — must not trigger revoke
    MockEventSource.instances[1]?.emitError()
    expect(revokeSpy).not.toHaveBeenCalled()
    expect(client.status).toEqual({ status: 'closed', reason: 'manual' })
  })

  // close() during a *delayed* renew attempt (maxAttempts=2, waiting between attempts)
  // must clear the renewRetryTimer so no further ES is created.
  it('close() during renew delay timer cancels the pending next attempt', async () => {
    const client = new SSEInvalidatorClient('/sse')

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 2, retryDelayMs: 1000 })
    )

    // First attempt fails, second is scheduled in ~1000ms
    MockEventSource.instances[1]?.emitError()
    expect(MockEventSource.instances).toHaveLength(2) // timer not fired yet

    // Close cancels the timer
    client.close()
    expect(client.status).toEqual({ status: 'closed', reason: 'manual' })

    // Advance well past the delay — no new ES should be created
    await vi.advanceTimersByTimeAsync(2000)
    expect(MockEventSource.instances).toHaveLength(2)
  })
})

describe('frameguard-spec §4.1.2 — chained renew (renew on the reconnected connection)', () => {
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

  // SPEC: wireRenewSuccess() calls wireInvalidateListener() on the new ES,
  // so a second renew frame arriving on the new connection must be handled
  // identically to the first — not silently ignored.
  //
  // CURRENT BEHAVIOUR: wireRenewSuccess calls wireInvalidateListener which does
  // re-register the renew listener. This should work — but this test makes it
  // observable and also verifies that the renewing flag is properly cleared
  // between cycles so the second renew isn't blocked.
  it('renew on the reconnected connection is handled correctly (chained renew cycles)', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const renewSpy = vi.fn()
    client.addEventListener('renew', (e: any) => renewSpy(e.detail))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // First renew — succeeds
    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )
    MockEventSource.instances[1]?.emitOpen()
    expect(client.status.status).toBe('open')
    expect(renewSpy).toHaveBeenCalledTimes(1)

    // Second renew on the new connection — must not be silently swallowed
    MockEventSource.instances[1]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )

    // renew event must have fired again
    expect(renewSpy).toHaveBeenCalledTimes(2)
    // A third EventSource must have been created for the second confirmatory attempt
    expect(MockEventSource.instances).toHaveLength(3)
  })
})

describe('frameguard-spec §4.1.2 — status stays connecting for the full renew sequence (maxAttempts > 1)', () => {
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

  // The client must stay in 'connecting' throughout the whole renew sequence —
  // it must NOT briefly flicker to 'error' or 'open' between attempts.
  it('status remains connecting throughout all renew attempts until final outcome', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const statuses: string[] = []
    client.addEventListener('statuschange', (e: any) => statuses.push(e.detail.status))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    // Clear the collected statuses so far (connecting, open)
    statuses.length = 0

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 2, retryDelayMs: 200 })
    )

    // At this point status should have gone to 'connecting'
    MockEventSource.instances[1]?.emitError()

    // After first failure, status must still be 'connecting' (second attempt pending)
    expect(client.status.status).toBe('connecting')

    // During the delay period — still connecting
    await vi.advanceTimersByTimeAsync(150)
    expect(client.status.status).toBe('connecting')

    // Second attempt fires, succeeds
    await vi.advanceTimersByTimeAsync(200)
    MockEventSource.instances[2]?.emitOpen()
    expect(client.status.status).toBe('open')

    // status sequence must not contain 'error' anywhere in the renew cycle
    expect(statuses).not.toContain('error')
    // and 'connecting' must appear before 'open'
    const connectingIdx = statuses.indexOf('connecting')
    const openIdx = statuses.lastIndexOf('open')
    expect(connectingIdx).toBeLessThan(openIdx)
  })
})

describe('frameguard-spec §4.1.2 — revoke event from renew exhaustion carries exactly { reason: deadline }', () => {
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

  // The existing test only checks maxAttempts=1. This one checks maxAttempts=2
  // to confirm that the intermediate failure path (onRenewError when attemptsRemaining
  // hits 0 after the second failure) also emits { reason: 'deadline' }, not some
  // other value or an empty object.
  it('revoke event after 2-attempt renew exhaustion has reason deadline', async () => {
    const client = new SSEInvalidatorClient('/sse')
    const revokeSpy = vi.fn()
    client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 2, retryDelayMs: 200 })
    )

    // First attempt fails
    MockEventSource.instances[1]?.emitError()

    // Second attempt fires after delay
    await vi.advanceTimersByTimeAsync(300)
    expect(MockEventSource.instances).toHaveLength(3)

    // Second attempt also fails
    MockEventSource.instances[2]?.emitError()

    expect(revokeSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).toHaveBeenCalledWith({ reason: 'deadline' })
    expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })
  })

  // The revoke event from renew exhaustion must NOT carry extra fields that would
  // make it look like an 'unsupported-target' revoke.
  it('revoke event from renew exhaustion does not contain requested or supported fields', async () => {
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
    MockEventSource.instances[1]?.emitError()

    const detail = revokeSpy.mock.calls[0][0]
    expect(detail.requested).toBeUndefined()
    expect(detail.supported).toBeUndefined()
  })
})

describe('frameguard-spec §4.1.2 — Last-Event-ID header carried to confirmatory reconnect', () => {
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

  // SPEC §4.1.2: "it reuses the same EventSource URL (which carries Last-Event-ID
  // in the header automatically)"
  // The implementation always uses this.eventSourceUrl for the renew ES — which
  // is the same URL. Native EventSource handles Last-Event-ID automatically.
  // What we CAN test: the renew confirmatory ES uses the SAME URL as the original,
  // including __restale_cid__ (so the server can correlate it with the same connection).
  it('confirmatory renew EventSource is created with the same URL as the original connection', async () => {
    const client = new SSEInvalidatorClient('/sse')

    const p = client.connect()
    MockEventSource.instances[0]?.emitOpen()
    await p

    const originalUrl = MockEventSource.instances[0]?.url

    MockEventSource.instances[0]?.emitCustomEvent(
      'renew',
      JSON.stringify({ reason: 'deadline', maxAttempts: 1, retryDelayMs: 250 })
    )

    expect(MockEventSource.instances).toHaveLength(2)
    const renewUrl = MockEventSource.instances[1]?.url

    // URL must be identical — same __restale_cid__, same path
    expect(renewUrl).toBe(originalUrl)
  })
})
