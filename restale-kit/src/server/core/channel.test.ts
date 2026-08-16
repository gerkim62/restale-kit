import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSEChannel, validateSignalPayload } from './channel.js'
import { ChannelClosedError, SchemaValidationError } from '@/types/errors.js'
import { createEventStore } from './event-store.js'
import { createValidSchema, createInvalidSchema } from '@/test-fixtures/schemas.js'

const decoder = new TextDecoder()

async function readStreamChunk(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const { value } = await reader.read()
  reader.releaseLock()
  return value ? decoder.decode(value) : ''
}

describe('channel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts in open state', () => {
    const channel = createSSEChannel({})
    expect(channel.state).toBe('open')
  })

  it.each([
    { key: ['todos'], action: 'unknown' },
    { key: ['todos'], type: 'paused' },
    { key: ['todos'], stale: 'true' },
    { key: ['todos'], action: 'unknown' },
    { key: ['todos'], match: 'contains' },
    { key: ['todos'], revalidate: 'false' },
    { key: ['todos'], action: 'unknown' },
    { key: ['todos'], exact: 'true' },
    { key: ['todos'], contextHash: 1 },
    { key: ['todos'], contextHash: false },
    { key: ['todos'], contextHash: {} },
  ])('rejects a malformed protocol field before it can be framed: %o', (signal) => {
    expect(() => {
      validateSignalPayload(signal)
    }).toThrow('[invalidate] Invalid')
  })

  it('closes idempotently and sets state to closed', () => {
    const channel = createSSEChannel({})
    channel.close()
    expect(channel.state).toBe('closed')
    channel.close() // should not throw
    expect(channel.state).toBe('closed')
  })

  it('disconnect calls close idempotently', () => {
    const channel = createSSEChannel({})
    channel.disconnect()
    expect(channel.state).toBe('closed')
  })

  it('throws ChannelClosedError on invalidate when closed', () => {
    const channel = createSSEChannel({})
    channel.close()
    expect(() => channel.invalidate({ key: ['test'] })).toThrow(ChannelClosedError)
  })

  it('does not emit keepalives by default when keepaliveIntervalMs is omitted', async () => {
    const channel = createSSEChannel({})
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(60000)

    channel.close()
    const { value, done } = await reader.read()
    reader.releaseLock()

    expect(done).toBe(true)
    expect(value).toBeUndefined()
  })

  it('emits keepalives at configured interval when keepaliveIntervalMs is provided', async () => {
    const channel = createSSEChannel({ keepaliveIntervalMs: 5000 })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(5000)

    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toBe(': keepalive\n\n')
  })

  it('uses eventStore and custom idGenerator during invalidate', () => {
    const store = createEventStore({ capacity: 10 })
    const channel = createSSEChannel({ eventStore: store })

    const id = channel.invalidate({ key: ['test-store'] })
    expect(id).toBeDefined()
    expect(id).not.toBe('')
    // Positively verify the event was recorded: a subsequent event added after id must appear
    const subsequentId = channel.invalidate({ key: ['subsequent'] })
    const { events: afterFirst, stale: staleAfterFirst } = store.getEventsAfter(id)
    expect(staleAfterFirst).toBe(false)
    expect(afterFirst.map((e) => e.id)).toContain(subsequentId) // subsequent event is visible after id
    // Nothing after the last recorded event
    const { events: afterId, stale: staleAfter } = store.getEventsAfter(subsequentId)
    expect(staleAfter).toBe(false)
    expect(afterId).toEqual([]) // nothing after the last recorded event
    // Unknown id returns stale: true
    const { stale: staleMiss } = store.getEventsAfter('0')
    expect(staleMiss).toBe(true)

    const customGen = vi.fn().mockReturnValue('custom-id-123')
    const customChannel = createSSEChannel({ eventBufferCapacity: 10, idGenerator: customGen })

    const generatedId = customChannel.invalidate({ key: ['test-custom'] })
    expect(generatedId).toBe('custom-id-123')
    expect(customGen).toHaveBeenCalled()
  })


  it('emits keepalive frame on timer interval when channel state is open', async () => {
    const channel = createSSEChannel({ keepaliveIntervalMs: 1000 })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(1000)
    const { value } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(value)).toBe(': keepalive\n\n')
  })

  it('auto-creates eventStore when eventBufferCapacity > 0 is provided', () => {
    const channel = createSSEChannel({ eventBufferCapacity: 20 })
    const id = channel.invalidate({ key: ['auto-store'] })
    expect(id).toBe('1') // EventStore auto-increment ID
  })

  it('exposes connectionId from options', () => {
    const channel = createSSEChannel({ connectionId: 'test-conn-id' })
    expect(channel.connectionId).toBe('test-conn-id')
  })

  it('connectionId defaults to empty string when not provided', () => {
    const channel = createSSEChannel({})
    expect(channel.connectionId).toBe('')
  })

  it('revoke() sends a revoke frame then closes the channel', async () => {
    const channel = createSSEChannel({})
    const reader = channel.stream.getReader()

    channel.revoke()

    const { value } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(value)).toBe('event: revoke\ndata: {"reason":"revoked"}\n\n')
    expect(channel.state).toBe('closed')
  })

  it('revoke() sends a revoke frame with a custom reason', async () => {
    const channel = createSSEChannel({})
    const reader = channel.stream.getReader()

    channel.revoke('logout')

    const { value } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(value)).toBe('event: revoke\ndata: {"reason":"logout"}\n\n')
    expect(channel.state).toBe('closed')
  })

  it('revoke() is idempotent — no-op when already closed', () => {
    const channel = createSSEChannel({})
    channel.close()
    expect(() => { channel.revoke() }).not.toThrow()
    expect(channel.state).toBe('closed')
  })

  it('revoke() fires onClose callbacks', () => {
    const channel = createSSEChannel({})
    const cb = vi.fn()
    channel.onClose(cb)

    channel.revoke()

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose fires callback when channel is closed', () => {
    const channel = createSSEChannel({})
    const cb = vi.fn()
    channel.onClose(cb)
    expect(cb).not.toHaveBeenCalled()
    channel.close()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose fires immediately if channel is already closed', () => {
    const channel = createSSEChannel({})
    channel.close()
    const cb = vi.fn()
    channel.onClose(cb)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose fires on disconnect', () => {
    const channel = createSSEChannel({})
    const cb = vi.fn()
    channel.onClose(cb)
    channel.disconnect()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose does not fire twice if close is called twice', () => {
    const channel = createSSEChannel({})
    const cb = vi.fn()
    channel.onClose(cb)
    channel.close()
    channel.close()
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

// ─── Frame Guard tests ────────────────────────────────────────────────────────

describe('Frame Guard — beforeFrame', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('send result — frame is delivered normally', async () => {
    const channel = createSSEChannel({
      beforeFrame: () => ({ action: 'send' }),
    })
    channel.invalidate({ key: ['items'] })
    const text = await readStreamChunk(channel.stream)
    expect(text).toContain('"key":["items"]')
  })

  it('skip result — frame is dropped, channel stays open, invalidate returns empty string', () => {
    const channel = createSSEChannel({
      beforeFrame: () => ({ action: 'skip' }),
    })
    const id = channel.invalidate({ key: ['items'] })
    expect(id).toBe('')
    expect(channel.state).toBe('open')
  })

  it('close result — revoke frame sent, channel closes, invalidate throws ChannelClosedError', async () => {
    const channel = createSSEChannel({
      beforeFrame: () => ({ action: 'close', reason: 'unauthorized' }),
    })
    const reader = channel.stream.getReader()
    expect(() => channel.invalidate({ key: ['items'] })).toThrow(ChannelClosedError)
    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toContain('"reason":"unauthorized"')
    expect(channel.state).toBe('closed')
  })

  it('close result without reason uses default revoke reason', async () => {
    const channel = createSSEChannel({
      beforeFrame: () => ({ action: 'close' }),
    })
    const reader = channel.stream.getReader()
    expect(() => channel.invalidate({ key: ['items'] })).toThrow(ChannelClosedError)
    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toContain('"reason":"revoked"')
  })

  it('ctx.signal contains the outgoing signal', () => {
    const capturedCtx: Array<{ signal: unknown; frameType: string }> = []
    const channel = createSSEChannel({
      beforeFrame: (ctx) => { capturedCtx.push({ signal: ctx.signal, frameType: ctx.frameType }); return { action: 'send' } },
    })
    channel.invalidate({ key: ['todos'] })
    expect(capturedCtx).toHaveLength(1)
    expect(capturedCtx[0].frameType).toBe('signal')
    expect(capturedCtx[0].signal).toMatchObject({ key: ['todos'] })
  })

  it('ctx.isResume is false for a fresh connection', () => {
    let isResume: boolean | undefined
    const channel = createSSEChannel({
      beforeFrame: (ctx) => { isResume = ctx.isResume; return { action: 'send' } },
    })
    channel.invalidate({ key: ['x'] })
    expect(isResume).toBe(false)
  })

  it('ctx.isResume is true when lastEventId is present', () => {
    const store = createEventStore({ capacity: 10 })
    let isResume: boolean | undefined
    const channel = createSSEChannel({
      lastEventId: 'some-id',
      eventStore: store,
      beforeFrame: (ctx) => { isResume = ctx.isResume; return { action: 'send' } },
    })
    channel.invalidate({ key: ['x'] })
    expect(isResume).toBe(true)
  })
})

describe('Frame Guard — guardKeepalive', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('guardKeepalive: false — beforeFrame not called on keepalive ticks', async () => {
    const guardSpy = vi.fn().mockReturnValue({ action: 'send' })
    const channel = createSSEChannel({
      keepaliveIntervalMs: 1000,
      beforeFrame: guardSpy,
      guardKeepalive: false,
    })
    const reader = channel.stream.getReader()
    await vi.advanceTimersByTimeAsync(1000)
    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toBe(': keepalive\n\n')
    expect(guardSpy).not.toHaveBeenCalled()
    channel.close()
  })

  it('guardKeepalive: true — beforeFrame called for keepalive, ctx.signal is undefined and frameType is keepalive', async () => {
    const capturedCtxs: Array<{ signal: unknown; frameType: string }> = []
    const channel = createSSEChannel({
      keepaliveIntervalMs: 1000,
      beforeFrame: (ctx) => { capturedCtxs.push({ signal: ctx.signal, frameType: ctx.frameType }); return { action: 'send' } },
      guardKeepalive: true,
    })
    const reader = channel.stream.getReader()
    await vi.advanceTimersByTimeAsync(1000)
    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toBe(': keepalive\n\n')
    expect(capturedCtxs).toHaveLength(1)
    expect(capturedCtxs[0].frameType).toBe('keepalive')
    expect(capturedCtxs[0].signal).toBeUndefined()
    channel.close()
  })

  it('guardKeepalive: true, skip result — keepalive is silently dropped, channel stays open', async () => {
    const channel = createSSEChannel({
      keepaliveIntervalMs: 1000,
      beforeFrame: () => ({ action: 'skip' }),
      guardKeepalive: true,
    })
    const reader = channel.stream.getReader()
    await vi.advanceTimersByTimeAsync(1000)
    // No frame should have been enqueued — channel is still open so no done yet
    expect(channel.state).toBe('open')
    channel.close()
    const { done } = await reader.read()
    reader.releaseLock()
    expect(done).toBe(true)
  })

  it('guardKeepalive: true, close result — channel is revoked on keepalive tick', async () => {
    const channel = createSSEChannel({
      keepaliveIntervalMs: 1000,
      beforeFrame: () => ({ action: 'close', reason: 'kicked' }),
      guardKeepalive: true,
    })
    const reader = channel.stream.getReader()
    await vi.advanceTimersByTimeAsync(1000)
    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toContain('"reason":"kicked"')
    expect(channel.state).toBe('closed')
  })

  it('guardKeepalive: false with no beforeFrame — no-op, keepalive emitted normally', async () => {
    // guardKeepalive alone (no beforeFrame) must be a no-op (spec §4.3)
    const channel = createSSEChannel({
      keepaliveIntervalMs: 1000,
      guardKeepalive: true, // set but no beforeFrame — should be inert
    })
    const reader = channel.stream.getReader()
    await vi.advanceTimersByTimeAsync(1000)
    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toBe(': keepalive\n\n')
    channel.close()
  })
})

describe('Frame Guard — lifetime', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('ttlMs: fires renew frame (default onDeadline) and closes channel', async () => {
    const channel = createSSEChannel({ lifetime: { ttlMs: 5000 } })
    const reader = channel.stream.getReader()

    // Advance past TTL + max jitter window
    await vi.advanceTimersByTimeAsync(6000)

    const { value } = await reader.read()
    reader.releaseLock()
    const text = decoder.decode(value)
    expect(text).toContain('event: renew')
    expect(text).toContain('"reason":"deadline"')
    expect(channel.state).toBe('closed')
  })

  it('deadline: fires renew frame when absolute deadline is reached', async () => {
    const now = Date.now()
    const channel = createSSEChannel({ lifetime: { deadline: now + 5000 } })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(6000)

    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toContain('event: renew')
    expect(channel.state).toBe('closed')
  })

  it('onDeadline: revoke — sends revoke frame instead of renew', async () => {
    const channel = createSSEChannel({
      lifetime: { ttlMs: 5000, onDeadline: 'revoke' },
    })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(6000)

    const { value } = await reader.read()
    reader.releaseLock()
    const text = decoder.decode(value)
    expect(text).toContain('event: revoke')
    expect(text).toContain('"reason":"deadline"')
    expect(text).not.toContain('event: renew')
    expect(channel.state).toBe('closed')
  })

  it('onDeadline object form — renew frame carries custom maxAttempts and retryDelayMs', async () => {
    const channel = createSSEChannel({
      lifetime: { ttlMs: 5000, onDeadline: { maxAttempts: 3, retryDelayMs: 400 } },
    })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(6000)

    const { value } = await reader.read()
    reader.releaseLock()
    const text = decoder.decode(value)
    expect(text).toContain('event: renew')
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'))!
    const payload: { maxAttempts: number; retryDelayMs: number } = JSON.parse(dataLine.slice('data: '.length))
    expect(payload.maxAttempts).toBe(3)
    expect(payload.retryDelayMs).toBe(400)
    expect(channel.state).toBe('closed')
  })

  it('rejects zero maxAttempts instead of sending a renew frame the client must reject', () => {
    expect(() => createSSEChannel({
      lifetime: { ttlMs: 5000, onDeadline: { maxAttempts: 0 } },
    })).toThrow('lifetime.onDeadline.maxAttempts must be a positive safe integer')
  })

  it('lifetime timer is cleared when channel closes before deadline', async () => {
    const channel = createSSEChannel({ lifetime: { ttlMs: 10000 } })
    channel.close()
    expect(channel.state).toBe('closed')
    // Advancing past TTL must not enqueue extra frames or throw
    await vi.advanceTimersByTimeAsync(15000)
    expect(channel.state).toBe('closed')
  })

  it('already-past deadline still fires (after minimum delay floor), not immediately', async () => {
    const past = Date.now() - 60000  // 1 minute in the past
    const channel = createSSEChannel({ lifetime: { deadline: past } })
    const reader = channel.stream.getReader()

    // Should NOT have fired synchronously at channel creation
    expect(channel.state).toBe('open')

    // Advance past the minimum delay floor (250 ms) + jitter window (500 ms)
    await vi.advanceTimersByTimeAsync(1000)

    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toContain('event: renew')
    expect(channel.state).toBe('closed')
  })

  it('no lifetime option — channel never closes on its own', async () => {
    const channel = createSSEChannel({})
    await vi.advanceTimersByTimeAsync(60000)
    expect(channel.state).toBe('open')
    channel.close()
  })

  it('lifetime timer fires onClose callbacks', async () => {
    const cb = vi.fn()
    const channel = createSSEChannel({ lifetime: { ttlMs: 1000 } })
    channel.onClose(cb)

    // Drain stream so it doesn't block closeInternal
    void channel.stream.getReader().read()

    await vi.advanceTimersByTimeAsync(2000)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})


describe('Frame Guard — additional spec coverage (FT-04 through FT-07)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // FT-04: guardKeepalive + beforeFrame + default keepaliveIntervalMs
  it('guardKeepalive: true with no keepaliveIntervalMs (default 0) — guard never fires on keepalives', async () => {
    const guardSpy = vi.fn().mockReturnValue({ action: 'send' })
    const channel = createSSEChannel({
      // keepaliveIntervalMs defaults to 0 — no keepalive ticks at all
      beforeFrame: guardSpy,
      guardKeepalive: true, // set, but will never fire because no keepalives
    })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(10000)

    // Guard should not have been called at all (no keepalive ticks)
    expect(guardSpy).not.toHaveBeenCalled()
    expect(channel.state).toBe('open')

    channel.close()
    reader.releaseLock()
  })

  // FT-05: onDeadline object form with partial fields
  it('onDeadline object with only maxAttempts set uses spec default for retryDelayMs', async () => {
    const channel = createSSEChannel({
      lifetime: { ttlMs: 1000, onDeadline: { maxAttempts: 5 } },
    })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(2000)

    const { value } = await reader.read()
    reader.releaseLock()

    const text = decoder.decode(value)
    expect(text).toContain('event: renew')
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'))!
    const payload: { maxAttempts: number; retryDelayMs: number } = JSON.parse(dataLine.slice('data: '.length))
    expect(payload.maxAttempts).toBe(5)
    expect(payload.retryDelayMs).toBe(250) // spec default
    channel.close()
  })

  it('onDeadline object with only retryDelayMs set uses spec default for maxAttempts', async () => {
    const channel = createSSEChannel({
      lifetime: { ttlMs: 1000, onDeadline: { retryDelayMs: 1000 } },
    })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(2000)

    const { value } = await reader.read()
    reader.releaseLock()

    const text = decoder.decode(value)
    expect(text).toContain('event: renew')
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'))!
    const payload: { maxAttempts: number; retryDelayMs: number } = JSON.parse(dataLine.slice('data: '.length))
    expect(payload.maxAttempts).toBe(1) // spec default
    expect(payload.retryDelayMs).toBe(1000)
    channel.close()
  })

  // FT-06: beforeFrame does NOT intercept lifetime deadline frames
  // The deadline timer fires directly — it bypasses beforeFrame entirely.
  // beforeFrame only runs for invalidate() calls, not for the renew/revoke
  // frames emitted by the lifetime timer. This test documents that contract.
  it('lifetime deadline fires renew frame even when beforeFrame would close — deadline bypasses beforeFrame', async () => {
    const beforeFrameSpy = vi.fn().mockReturnValue({ action: 'close', reason: 'guard-rejected' })
    const channel = createSSEChannel({
      lifetime: { ttlMs: 1000, onDeadline: 'reconnect' },
      beforeFrame: beforeFrameSpy,
    })
    const reader = channel.stream.getReader()

    // Wait past deadline
    await vi.advanceTimersByTimeAsync(2000)

    const { value } = await reader.read()
    reader.releaseLock()

    const text = decoder.decode(value)
    // The deadline timer calls fireDeadline() → controller.enqueue(formatRenewFrame(...))
    // directly, bypassing beforeFrame entirely. The renew frame is emitted as-is.
    expect(text).toContain('event: renew')
    // beforeFrame was not called by the deadline path (only by invalidate())
    expect(beforeFrameSpy).not.toHaveBeenCalled()
    expect(channel.state).toBe('closed')
  })

  // FT-07: isResume with lastEventId but no eventStore
  it('ctx.isResume is true when lastEventId is set even with no eventStore', () => {
    let capturedIsResume: boolean | undefined
    const channel = createSSEChannel({
      lastEventId: 'some-id', // triggers isResume=true
      beforeFrame: (ctx) => {
        capturedIsResume = ctx.isResume
        return { action: 'send' }
      },
    })

    channel.invalidate({ key: ['test'] })
    expect(capturedIsResume).toBe(true)

    channel.close()
  })

  it('handles write error during stream write gracefully', async () => {
    const channel = createSSEChannel({})
    const reader = channel.stream.getReader()
    await reader.cancel(new Error('EPIPE'))
    expect(() => channel.invalidate({ key: ['test'] })).toThrow()
  })
})
