import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSEChannel, validateSignalPayload } from './channel.js'
import { ChannelClosedError, SchemaValidationError } from '@/types/errors.js'
import { createEventStore } from './event-store.js'
import { createValidSchema, createInvalidSchema } from '@/test-fixtures/schemas.js'

const decoder = new TextDecoder()

async function readStreamChunk(stream: ReadableStream<Uint8Array>, skipConnected = true): Promise<string> {
  const reader = stream.getReader()
  let { value } = await reader.read()
  if (skipConnected && value) {
    const str = decoder.decode(value)
    if (str.startsWith('event: connected\n')) {
      const next = await reader.read()
      value = next.value
    }
  }
  reader.releaseLock()
  return value ? decoder.decode(value) : ''
}

async function readNextChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let { value } = await reader.read()
  if (value) {
    const str = decoder.decode(value)
    if (str.startsWith('event: connected\n')) {
      const next = await reader.read()
      value = next.value
    }
  }
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
    try {
      expect(channel.state).toBe('open')
    } finally {
      channel.close()
    }
  })

  it('emits connected frame as first event in stream', async () => {
    const channel = createSSEChannel()
    try {
      const reader = channel.stream.getReader()
      const { value } = await reader.read()
      reader.releaseLock()
      expect(decoder.decode(value)).toBe(`event: connected\ndata: {"connectionId":"${channel.connectionId}"}\n\n`)
    } finally {
      channel.close()
    }
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

    // Consume initial connected frame
    await reader.read()

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

    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toBe(': keepalive\n\n')
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
    const text = await readNextChunk(reader)
    reader.releaseLock()

    expect(text).toBe(': keepalive\n\n')
  })

  it('auto-creates eventStore when eventBufferCapacity > 0 is provided', () => {
    const channel = createSSEChannel({ eventBufferCapacity: 20 })
    const id = channel.invalidate({ key: ['auto-store'] })
    expect(id).toBe('1') // EventStore auto-increment ID
  })

  it('exposes server-generated connectionId', () => {
    const channel = createSSEChannel()
    expect(typeof channel.connectionId).toBe('string')
    expect(channel.connectionId.length).toBeGreaterThan(0)
  })

  it('revoke() sends a revoke frame then closes the channel', async () => {
    const channel = createSSEChannel({})
    const reader = channel.stream.getReader()

    channel.revoke()

    const text = await readNextChunk(reader)
    reader.releaseLock()

    expect(text).toBe('event: revoke\ndata: {"reason":"revoked"}\n\n')
    expect(channel.state).toBe('closed')
  })

  it('revoke() sends a revoke frame with a custom reason', async () => {
    const channel = createSSEChannel({})
    const reader = channel.stream.getReader()

    channel.revoke('logout')

    const text = await readNextChunk(reader)
    reader.releaseLock()

    expect(text).toBe('event: revoke\ndata: {"reason":"logout"}\n\n')
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
    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toContain('"reason":"unauthorized"')
    expect(channel.state).toBe('closed')
  })

  it('close result without reason uses default revoke reason', async () => {
    const channel = createSSEChannel({
      beforeFrame: () => ({ action: 'close' }),
    })
    const reader = channel.stream.getReader()
    expect(() => channel.invalidate({ key: ['items'] })).toThrow(ChannelClosedError)
    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toContain('"reason":"revoked"')
  })

  it('treats error thrown in beforeFrame as action: close', async () => {
    const channel = createSSEChannel({
      beforeFrame: () => {
        throw new Error('Guard exploded')
      },
    })
    const reader = channel.stream.getReader()
    expect(() => channel.invalidate({ key: ['items'] })).toThrow(ChannelClosedError)
    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toContain('"reason":"revoked"')
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
    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toBe(': keepalive\n\n')
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
    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toBe(': keepalive\n\n')
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
    // Consume connected frame
    await reader.read()
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
    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toContain('"reason":"kicked"')
    expect(channel.state).toBe('closed')
  })

  it('guardKeepalive: false with no beforeFrame — no-op, keepalive emitted normally', async () => {
    const channel = createSSEChannel({
      keepaliveIntervalMs: 1000,
      guardKeepalive: true,
    })
    const reader = channel.stream.getReader()
    await vi.advanceTimersByTimeAsync(1000)
    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toBe(': keepalive\n\n')
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

    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toContain('event: renew')
    expect(text).toContain('"reason":"deadline"')
    expect(channel.state).toBe('closed')
  })

  it('deadline: fires renew frame when absolute deadline is reached', async () => {
    const now = Date.now()
    const channel = createSSEChannel({ lifetime: { deadline: now + 5000 } })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(6000)

    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toContain('event: renew')
    expect(channel.state).toBe('closed')
  })

  it('onDeadline: revoke — sends revoke frame instead of renew', async () => {
    const channel = createSSEChannel({
      lifetime: { ttlMs: 5000, onDeadline: 'revoke' },
    })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(6000)

    const text = await readNextChunk(reader)
    reader.releaseLock()
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

    const text = await readNextChunk(reader)
    reader.releaseLock()
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
    await vi.advanceTimersByTimeAsync(15000)
    expect(channel.state).toBe('closed')
  })

  it('already-past deadline still fires (after minimum delay floor), not immediately', async () => {
    const past = Date.now() - 60000
    const channel = createSSEChannel({ lifetime: { deadline: past } })
    const reader = channel.stream.getReader()

    expect(channel.state).toBe('open')

    await vi.advanceTimersByTimeAsync(1000)

    const text = await readNextChunk(reader)
    reader.releaseLock()
    expect(text).toContain('event: renew')
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

  it('guardKeepalive: true with no keepaliveIntervalMs (default 0) — guard never fires on keepalives', async () => {
    const guardSpy = vi.fn().mockReturnValue({ action: 'send' })
    const channel = createSSEChannel({
      beforeFrame: guardSpy,
      guardKeepalive: true,
    })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(10000)

    expect(guardSpy).not.toHaveBeenCalled()
    expect(channel.state).toBe('open')

    channel.close()
    reader.releaseLock()
  })

  it('onDeadline object with only maxAttempts set uses spec default for retryDelayMs', async () => {
    const channel = createSSEChannel({
      lifetime: { ttlMs: 1000, onDeadline: { maxAttempts: 5 } },
    })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(2000)

    const text = await readNextChunk(reader)
    reader.releaseLock()

    expect(text).toContain('event: renew')
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'))!
    const payload: { maxAttempts: number; retryDelayMs: number } = JSON.parse(dataLine.slice('data: '.length))
    expect(payload.maxAttempts).toBe(5)
    expect(payload.retryDelayMs).toBe(250)
    channel.close()
  })

  it('onDeadline object with only retryDelayMs set uses spec default for maxAttempts', async () => {
    const channel = createSSEChannel({
      lifetime: { ttlMs: 1000, onDeadline: { retryDelayMs: 1000 } },
    })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(2000)

    const text = await readNextChunk(reader)
    reader.releaseLock()

    expect(text).toContain('event: renew')
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'))!
    const payload: { maxAttempts: number; retryDelayMs: number } = JSON.parse(dataLine.slice('data: '.length))
    expect(payload.maxAttempts).toBe(1)
    expect(payload.retryDelayMs).toBe(1000)
    channel.close()
  })

  it('lifetime deadline fires renew frame even when beforeFrame would close — deadline bypasses beforeFrame', async () => {
    const beforeFrameSpy = vi.fn().mockReturnValue({ action: 'close', reason: 'guard-rejected' })
    const channel = createSSEChannel({
      lifetime: { ttlMs: 1000, onDeadline: 'reconnect' },
      beforeFrame: beforeFrameSpy,
    })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(2000)

    const text = await readNextChunk(reader)
    reader.releaseLock()

    expect(text).toContain('event: renew')
    expect(beforeFrameSpy).not.toHaveBeenCalled()
    expect(channel.state).toBe('closed')
  })

  it('ctx.isResume is true when lastEventId is set even with no eventStore', () => {
    let capturedIsResume: boolean | undefined
    const channel = createSSEChannel({
      lastEventId: 'some-id',
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

  describe('validateChannelOptions (sad paths)', () => {
    it('throws RangeError on negative or non-integer eventBufferCapacity and retryIntervalMs', () => {
      expect(() => createSSEChannel({ eventBufferCapacity: -1 })).toThrow(RangeError)
      expect(() => createSSEChannel({ eventBufferCapacity: 1.5 })).toThrow(RangeError)
      expect(() => createSSEChannel({ retryIntervalMs: -500 })).toThrow(RangeError)
      expect(() => createSSEChannel({ retryIntervalMs: 2.5 })).toThrow(RangeError)
    })

    it('throws RangeError on negative or non-finite keepaliveIntervalMs', () => {
      expect(() => createSSEChannel({ keepaliveIntervalMs: -10 })).toThrow(RangeError)
      expect(() => createSSEChannel({ keepaliveIntervalMs: Infinity })).toThrow(RangeError)
      expect(() => createSSEChannel({ keepaliveIntervalMs: NaN })).toThrow(RangeError)
    })

    it('validates lifetime options constraints and ranges', () => {
      // Mutually exclusive ttlMs and deadline
      expect(() => createSSEChannel({ lifetime: { ttlMs: 1000, deadline: 2000 } as any })).toThrow(
        '[createSSEChannel] lifetime.ttlMs and lifetime.deadline are mutually exclusive.'
      )

      // Negative ttlMs or deadline
      expect(() => createSSEChannel({ lifetime: { ttlMs: -1 } })).toThrow(RangeError)
      expect(() => createSSEChannel({ lifetime: { deadline: -1 } })).toThrow(RangeError)

      // Invalid onDeadline.maxAttempts
      expect(() => createSSEChannel({ lifetime: { ttlMs: 1000, onDeadline: { maxAttempts: 0 } } })).toThrow(
        RangeError
      )
      expect(() => createSSEChannel({ lifetime: { ttlMs: 1000, onDeadline: { maxAttempts: -1 } } })).toThrow(
        RangeError
      )
    })
  })
})

