import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatInvalidateFrame, formatRevokeFrame, formatRenewFrame } from '@/server/core/framing.js'
import { SSEClient } from '@/client/core/sse-client.js'
import { MockEventSource } from '@/test-fixtures/event-source.js'
import type { Signal, RevalidateSignal, InlineDataSignal } from '@/types/protocol.js'

vi.mock('sse.js', async () => {
  const { MockEventSource: SSE } = await import('@/test-fixtures/event-source.js')
  return { SSE }
})

/**
 * Parses raw SSE wire frame text into its event type, joined data string, and optional ID.
 * Emulates the browser / EventSource standard parsing logic where consecutive `data:` lines
 * are joined with `\n`.
 */
function parseSSEFrame(wireText: string): { eventType: string; data: string; id?: string } {
  const lines = wireText.split(/\r?\n/)
  let eventType = 'message'
  const dataLines: string[] = []
  let id: string | undefined

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      const rest = line.slice(5)
      dataLines.push(rest.startsWith(' ') ? rest.slice(1) : rest)
    } else if (line.startsWith('id:')) {
      id = line.slice(3).trim()
    }
  }

  return {
    eventType,
    data: dataLines.join('\n'),
    ...(id !== undefined ? { id } : {}),
  }
}

/**
 * Helper to feed raw encoded server bytes through MockEventSource into an active client.
 */
function dispatchWireFrame(source: MockEventSource, frameBytes: Uint8Array): void {
  const decoder = new TextDecoder()
  const rawText = decoder.decode(frameBytes)
  const { eventType, data, id } = parseSSEFrame(rawText)
  source.emitCustomEvent(eventType, data, id ?? '')
}

describe('Wire round trip (server bytes → client parse)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockEventSource.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('round-trips a single RevalidateSignal', async () => {
    const signal: RevalidateSignal = { key: ['todos', 'list'], exact: true }
    const client = new SSEClient('/sse')
    const received: Signal[] = []

    client.addEventListener('invalidate', (event: any) => {
      received.push(event.detail)
    })

    const connectPromise = client.connect()
    const source = MockEventSource.instances[0]
    expect(source).toBeDefined()
    source.emitOpen()
    await connectPromise

    const bytes = formatInvalidateFrame(signal, 'evt-1')
    dispatchWireFrame(source, bytes)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(signal)
    expect(client.lastEventId).toBe('evt-1')
  })

  it('round-trips a single InlineDataSignal with markStale', async () => {
    const signal: InlineDataSignal = {
      key: ['todos', 42],
      inlineData: { id: 42, title: 'Buy milk', done: false },
      markStale: true,
    }
    const client = new SSEClient('/sse')
    const received: Signal[] = []

    client.addEventListener('invalidate', (event: any) => {
      received.push(event.detail)
    })

    const connectPromise = client.connect()
    const source = MockEventSource.instances[0]
    source.emitOpen()
    await connectPromise

    const bytes = formatInvalidateFrame(signal, 'evt-2')
    dispatchWireFrame(source, bytes)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(signal)
  })

  it('round-trips a batch array containing both RevalidateSignal and InlineDataSignal', async () => {
    const batch: Signal[] = [
      { key: ['posts'], exact: false },
      { key: ['users', 'profile'], inlineData: { username: 'alice' }, markStale: true },
      { key: ['comments', 101], inlineData: { text: 'Great post!' } },
    ]
    const client = new SSEClient('/sse')
    const received: any[] = []

    client.addEventListener('invalidate', (event: any) => {
      received.push(event.detail)
    })

    const connectPromise = client.connect()
    const source = MockEventSource.instances[0]
    source.emitOpen()
    await connectPromise

    const bytes = formatInvalidateFrame(batch, 'evt-batch-1')
    dispatchWireFrame(source, bytes)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(batch)
  })

  it('round-trips a signal with embedded newlines across multi-line data frames', async () => {
    const signal: Signal = {
      key: ['query\nwith\nnewlines', 'item\r\nvalue'],
    }
    const client = new SSEClient('/sse')
    const received: any[] = []

    client.addEventListener('invalidate', (event: any) => {
      received.push(event.detail)
    })

    const connectPromise = client.connect()
    const source = MockEventSource.instances[0]
    source.emitOpen()
    await connectPromise

    const bytes = formatInvalidateFrame(signal)
    dispatchWireFrame(source, bytes)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(signal)
  })

  describe('formatRevokeFrame round trip', () => {
    it('handles defined reason', async () => {
      const client = new SSEClient('/sse')
      const revokeSpy = vi.fn()
      client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

      const connectPromise = client.connect()
      const source = MockEventSource.instances[0]
      source.emitOpen()
      await connectPromise

      const bytes = formatRevokeFrame('session-expired')
      dispatchWireFrame(source, bytes)

      expect(revokeSpy).toHaveBeenCalledTimes(1)
      expect(revokeSpy).toHaveBeenCalledWith({ reason: 'session-expired' })
      expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })
    })

    it('handles undefined reason', async () => {
      const client = new SSEClient('/sse')
      const revokeSpy = vi.fn()
      client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

      const connectPromise = client.connect()
      const source = MockEventSource.instances[0]
      source.emitOpen()
      await connectPromise

      const bytes = formatRevokeFrame(undefined)
      dispatchWireFrame(source, bytes)

      expect(revokeSpy).toHaveBeenCalledTimes(1)
      expect(revokeSpy).toHaveBeenCalledWith({})
      expect(revokeSpy.mock.calls[0][0].reason).toBeUndefined()
      expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })
    })

    it('handles empty string reason', async () => {
      const client = new SSEClient('/sse')
      const revokeSpy = vi.fn()
      client.addEventListener('revoke', (e: any) => revokeSpy(e.detail))

      const connectPromise = client.connect()
      const source = MockEventSource.instances[0]
      source.emitOpen()
      await connectPromise

      const bytes = formatRevokeFrame('')
      dispatchWireFrame(source, bytes)

      expect(revokeSpy).toHaveBeenCalledTimes(1)
      expect(revokeSpy).toHaveBeenCalledWith({ reason: '' })
      expect(client.status).toEqual({ status: 'closed', reason: 'revoked' })
    })
  })

  describe('formatRenewFrame round trip', () => {
    it('handles renew frame and emits renew event with server parameters', async () => {
      const client = new SSEClient('/sse')
      const renewSpy = vi.fn()
      client.addEventListener('renew', (e: any) => renewSpy(e.detail))

      const connectPromise = client.connect()
      const source = MockEventSource.instances[0]
      source.emitOpen()
      await connectPromise

      const bytes = formatRenewFrame(2, 300)
      dispatchWireFrame(source, bytes)

      expect(renewSpy).toHaveBeenCalledTimes(1)
      expect(renewSpy).toHaveBeenCalledWith({
        reason: 'deadline',
        maxAttempts: 2,
        retryDelayMs: 300,
      })
    })
  })
})
