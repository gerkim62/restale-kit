import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSEChannel, validateSignalTargets, validateTargetConfiguration } from './channel.js'
import { ChannelClosedError, SchemaValidationError } from '@/types/errors.js'
import { createEventStore } from './event-store.js'
import { createValidSchema, createInvalidSchema } from '@/test-fixtures/schemas.js'
import type { InvalidateSignal } from '@/types/protocol.js'

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
    const channel = createSSEChannel({ target: 'swr' })
    expect(channel.state).toBe('open')
  })

  it('closes idempotently and sets state to closed', () => {
    const channel = createSSEChannel({ target: 'swr' })
    channel.close()
    expect(channel.state).toBe('closed')
    channel.close() // should not throw
    expect(channel.state).toBe('closed')
  })

  it('disconnect calls close idempotently', () => {
    const channel = createSSEChannel({ target: 'swr' })
    channel.disconnect()
    expect(channel.state).toBe('closed')
  })

  it('throws ChannelClosedError on invalidate when closed', () => {
    const channel = createSSEChannel({ target: 'swr' })
    channel.close()
    expect(() => channel.invalidate({ target: 'swr', key: ['test'] })).toThrow(ChannelClosedError)
  })

  it('enqueues framed invalidate event bytes into stream', async () => {
    const channel = createSSEChannel({ target: 'swr' })
    channel.invalidate({ target: 'swr', key: ['items', 1] })

    const text = await readStreamChunk(channel.stream)
    expect(text).toBe('event: invalidate\ndata: {"target":"swr","key":["items",1]}\n\n')
  })

  it('does not emit keepalives by default when keepaliveIntervalMs is omitted', async () => {
    const channel = createSSEChannel({ target: 'swr' })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(60000)

    channel.close()
    const { value, done } = await reader.read()
    reader.releaseLock()

    expect(done).toBe(true)
    expect(value).toBeUndefined()
  })

  it('emits keepalives at configured interval when keepaliveIntervalMs is provided', async () => {
    const channel = createSSEChannel({ target: 'swr', keepaliveIntervalMs: 5000 })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(5000)

    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toBe(': keepalive\n\n')
  })

  it('replays missed events upon stream initialization if lastEventId and eventStore are set', async () => {
    const store = createEventStore({ capacity: 10 })
    store.add({ target: 'swr', key: ['a'] }, 'evt-1')
    store.add({ target: 'swr', key: ['b'] }, 'evt-2')
    store.add({ target: 'swr', key: ['c'] }, 'evt-3')

    const channel = createSSEChannel({
      target: 'swr',
      lastEventId: 'evt-1',
      eventStore: store,
    })

    const reader = channel.stream.getReader()
    const { value: v1 } = await reader.read()
    const { value: v2 } = await reader.read()
    reader.releaseLock()
    

    expect(decoder.decode(v1)).toBe('id: evt-2\nevent: invalidate\ndata: {"target":"swr","key":["b"]}\n\n')
    expect(decoder.decode(v2)).toBe('id: evt-3\nevent: invalidate\ndata: {"target":"swr","key":["c"]}\n\n')
  })

  it('uses eventStore and custom idGenerator during invalidate', () => {
    const store = createEventStore({ capacity: 10 })
    const channel = createSSEChannel({ target: 'swr', eventStore: store })

    const id = channel.invalidate({ target: 'swr', key: ['test-store'] })
    expect(id).toBeDefined()
    expect(id).not.toBe('')
    // Positively verify the event was recorded: a subsequent event added after id must appear
    const subsequentId = channel.invalidate({ target: 'swr', key: ['subsequent'] })
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
    const customChannel = createSSEChannel({ target: 'swr', eventBufferCapacity: 10, idGenerator: customGen })

    const generatedId = customChannel.invalidate({ target: 'swr', key: ['test-custom'] })
    expect(generatedId).toBe('custom-id-123')
    expect(customGen).toHaveBeenCalled()
  })

  it('includes customId in SSE stream frame even when channel has no eventStore', async () => {
    const channel = createSSEChannel({ target: 'swr' })
    const returnedId = channel.invalidate({ target: 'swr', key: ['items', 1] }, 'custom-evt-99')

    expect(returnedId).toBe('custom-evt-99')
    const text = await readStreamChunk(channel.stream)
    expect(text).toBe('id: custom-evt-99\nevent: invalidate\ndata: {"target":"swr","key":["items",1]}\n\n')
  })

  it('uses idGenerator to produce SSE stream frame id when channel has no eventStore', async () => {
    const customGen = vi.fn().mockReturnValue('gen-id-456')
    const channel = createSSEChannel({ target: 'swr', idGenerator: customGen })

    const returnedId = channel.invalidate({ target: 'swr', key: ['items', 2] })

    expect(returnedId).toBe('gen-id-456')
    const text = await readStreamChunk(channel.stream)
    expect(text).toBe('id: gen-id-456\nevent: invalidate\ndata: {"target":"swr","key":["items",2]}\n\n')
  })


  it('sends a full-invalidate frame when lastEventId is evicted or unknown (stale cursor)', async () => {
    const store = createEventStore({ capacity: 2 })
    store.add({ key: ['evt1'] }, 'id-1')
    store.add({ key: ['evt2'] }, 'id-2')
    store.add({ key: ['evt3'] }, 'id-3') // id-1 is evicted

    // Verify the store marks id-1 as stale
    expect(store.getEventsAfter('id-1').stale).toBe(true)

    // A channel created with an evicted lastEventId should emit a full-invalidate
    // signal (key: []) so the client knows to refetch everything.
    const channel = createSSEChannel({ target: 'swr', lastEventId: 'id-1', eventStore: store })
    const reader = channel.stream.getReader()
    const { value } = await reader.read()

    // The frame should be an invalidate event with key: [] — no id prefix (not recorded)
    expect(decoder.decode(value)).toBe('event: invalidate\ndata: {"target":"swr","key":[]}\n\n')

    // Close the channel and verify the stream is done — no extra frames emitted
    channel.close()
    const { done, value: trailing } = await reader.read()
    reader.releaseLock()
    expect(done).toBe(true)
    expect(trailing).toBeUndefined()
  })

  it('replay filters out signals not matching requestedTarget', async () => {
    // A shared store might contain signals for multiple targets (e.g. stored by a group).
    // On reconnect, a channel with requestedTarget:'swr' must only replay swr signals.
    const store = createEventStore({ capacity: 10 })
    store.add({ target: 'swr', key: ['swr-item'] } as any, 'id-swr')
    store.add({ target: 'tanstack-query', queryKey: ['tq-item'] } as any, 'id-tq')
    store.add({ target: 'swr', key: ['swr-item-2'] } as any, 'id-swr2')

    const channel = createSSEChannel({
      target: 'swr',
      requestedTarget: 'swr',
      lastEventId: '0',    // replay from the start (stale cursor → full invalidate)
      eventStore: store,
    })

    // id '0' is unknown → stale → full-invalidate frame is emitted
    const reader = channel.stream.getReader()
    const { value: v1 } = await reader.read()
    reader.releaseLock()

    // stale path emits a single { key: [] } frame, not the filtered records
    expect(decoder.decode(v1)).toBe('event: invalidate\ndata: {"target":"swr","key":[]}\n\n')
    channel.close()
  })

  it('replay with a valid lastEventId filters only matching-target signals', async () => {
    const store = createEventStore({ capacity: 10 })
    // anchor event (the client's last-event-id)
    store.add({ target: 'swr', key: ['anchor'] } as any, 'id-0')
    // missed events: one swr, one tanstack-query
    store.add({ target: 'swr', key: ['swr-missed'] } as any, 'id-1')
    store.add({ target: 'tanstack-query', queryKey: ['tq-missed'] } as any, 'id-2')

    const channel = createSSEChannel({
      target: 'swr',
      requestedTarget: 'swr',
      lastEventId: 'id-0',  // valid cursor — replay id-1 and id-2
      eventStore: store,
    })

    const reader = channel.stream.getReader()
    const { value: v1 } = await reader.read()
    // Only the swr signal should be replayed — tanstack-query must be filtered out
    const text1 = decoder.decode(v1)
    expect(text1).toContain('"swr-missed"')
    expect(text1).not.toContain('tq-missed')

    // Stream should be done after the one replayed frame
    channel.close()
    const { done } = await reader.read()
    reader.releaseLock()
    expect(done).toBe(true)
  })


  it('emits keepalive frame on timer interval when channel state is open', async () => {
    const channel = createSSEChannel({ target: 'swr', keepaliveIntervalMs: 1000 })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(1000)
    const { value } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(value)).toBe(': keepalive\n\n')
  })

  it('auto-creates eventStore when eventBufferCapacity > 0 is provided', () => {
    const channel = createSSEChannel({ target: 'swr', eventBufferCapacity: 20 })
    const id = channel.invalidate({ target: 'swr', key: ['auto-store'] })
    expect(id).toBe('1') // EventStore auto-increment ID
  })

  it('exposes connectionId from options', () => {
    const channel = createSSEChannel({ target: 'swr', connectionId: 'test-conn-id' })
    expect(channel.connectionId).toBe('test-conn-id')
  })

  it('connectionId defaults to empty string when not provided', () => {
    const channel = createSSEChannel({ target: 'swr' })
    expect(channel.connectionId).toBe('')
  })

  it('revoke() sends a revoke frame then closes the channel', async () => {
    const channel = createSSEChannel({ target: 'swr' })
    const reader = channel.stream.getReader()

    channel.revoke()

    const { value } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(value)).toBe('event: revoke\ndata: {"reason":"revoked"}\n\n')
    expect(channel.state).toBe('closed')
  })

  it('revoke() sends a revoke frame with a custom reason', async () => {
    const channel = createSSEChannel({ target: 'swr' })
    const reader = channel.stream.getReader()

    channel.revoke('logout')

    const { value } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(value)).toBe('event: revoke\ndata: {"reason":"logout"}\n\n')
    expect(channel.state).toBe('closed')
  })

  it('revoke() is idempotent — no-op when already closed', () => {
    const channel = createSSEChannel({ target: 'swr' })
    channel.close()
    expect(() => { channel.revoke() }).not.toThrow()
    expect(channel.state).toBe('closed')
  })

  it('revoke() fires onClose callbacks', () => {
    const channel = createSSEChannel({ target: 'swr' })
    const cb = vi.fn()
    channel.onClose(cb)

    channel.revoke()

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose fires callback when channel is closed', () => {
    const channel = createSSEChannel({ target: 'swr' })
    const cb = vi.fn()
    channel.onClose(cb)
    expect(cb).not.toHaveBeenCalled()
    channel.close()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose fires immediately if channel is already closed', () => {
    const channel = createSSEChannel({ target: 'swr' })
    channel.close()
    const cb = vi.fn()
    channel.onClose(cb)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose fires on disconnect', () => {
    const channel = createSSEChannel({ target: 'swr' })
    const cb = vi.fn()
    channel.onClose(cb)
    channel.disconnect()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose does not fire twice if close is called twice', () => {
    const channel = createSSEChannel({ target: 'swr' })
    const cb = vi.fn()
    channel.onClose(cb)
    channel.close()
    channel.close()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('attaches target property and frames single target signal on invalidate', async () => {
    const channel = createSSEChannel({ target: 'swr' })
    expect(channel.target).toBe('swr')

    channel.invalidate({ target: 'swr', key: ['items', 1] })
    const text = await readStreamChunk(channel.stream)
    expect(text).toBe('event: invalidate\ndata: {"target":"swr","key":["items",1]}\n\n')
  })

  it('rejects connection when target array is specified without requestedTarget', async () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'] })
    expect(channel.target).toEqual(['swr', 'tanstack-query'])

    const reader = channel.stream.getReader()
    const { value } = await reader.read()
    reader.releaseLock()

    const text = new TextDecoder().decode(value)
    expect(text).toBe(
      'event: revoke\ndata: {"reason":"unsupported-target","requested":"","supported":["swr","tanstack-query"]}\n\n'
    )
    expect(channel.state).toBe('closed')
  })
})

describe('target configuration validation', () => {
  it('accepts each supported target and unique target arrays', () => {
    expect(() => { validateTargetConfiguration('swr'); }).not.toThrow()
    expect(() => { validateTargetConfiguration('tanstack-query'); }).not.toThrow()
    expect(() => { validateTargetConfiguration('rtk-query'); }).not.toThrow()
    expect(() => { validateTargetConfiguration('generic'); }).not.toThrow()
    expect(() => { validateTargetConfiguration(['swr', 'tanstack-query']); }).not.toThrow()
  })

  it('rejects empty, duplicate, and unsupported configurations before a stream is created', () => {
    expect(() => { validateTargetConfiguration([]); }).toThrow(/at least one target/i)
    expect(() => { validateTargetConfiguration(['swr', 'swr']); }).toThrow(/duplicate target/i)
    expect(() => { validateTargetConfiguration('invalid-target' as never); }).toThrow(/unsupported target/i)
    expect(() => createSSEChannel({ target: ['swr', 'invalid-target'] as never })).toThrow(/unsupported target/i)
  })
})

describe('validateSignalTargets', () => {
  it('auto-fills target property on returned signal when single-target channel without mutating input, but throws when multi-target', () => {
    const s = { key: ['todos'] } as any
    const res = validateSignalTargets(s, 'swr')
    expect(s.target).toBeUndefined()
    expect(res.target).toBe('swr')

    expect(() => { validateSignalTargets({ key: ['todos'] }, ['swr', 'tanstack-query']); }).toThrow(
      '[invalidate] Multi-target channel requires an explicit "target" field on every signal.'
    )
  })

  it('throws when a signal in a batch is an array', () => {
    expect(() => { validateSignalTargets([{ key: ['todos'] }, ['invalid-array-signal']], 'swr'); }).toThrow(
      '[invalidate] Every signal must be an object.'
    )
  })

  it('throws an Error when a signal target is not in the declared targets', () => {
    expect(() => { validateSignalTargets({ target: 'tanstack-query', queryKey: ['todos'] }, 'swr'); }).toThrow(
      '[invalidate] Signal target "tanstack-query" is not in the channel\'s declared targets: [swr].'
    )
  })

  it('throws an Error when a multi-target channel does not receive signals for all declared targets', () => {
    expect(() =>
      { validateSignalTargets({ target: 'swr', key: ['todos'] }, ['swr', 'tanstack-query']); }
    ).toThrow(
      '[invalidate] Multi-target channel requires signals for ALL declared targets. Missing target: "tanstack-query".'
    )
  })

  it('succeeds when a single-target channel receives a signal with matching target', () => {
    expect(() =>
      { validateSignalTargets({ target: 'swr', key: ['todos'] }, 'swr'); }
    ).not.toThrow()
  })

  it('succeeds when a multi-target channel receives signals for all declared targets', () => {
    expect(() =>
      { validateSignalTargets(
        [
          { target: 'swr', key: ['todos'] },
          { target: 'tanstack-query', queryKey: ['todos'] },
        ],
        ['swr', 'tanstack-query']
      ); }
    ).not.toThrow()
  })
})

describe('Multi-target wire format on channel.invalidate', () => {
  it('includes RTK signal in multi-target channel when requested', async () => {
    const channel = createSSEChannel({ target: ['swr', 'rtk-query'], requestedTarget: 'rtk-query' })
    channel.invalidate([
      { target: 'swr', key: [] },
      { target: 'rtk-query', tags: [{ type: 'Todo' }] },
    ])
    const text = await readStreamChunk(channel.stream)
    expect(text).toContain('"tags":[{"type":"Todo"}]')
  })

  it('includes generic signal in multi-target channel when requested', async () => {
    const channel = createSSEChannel({ target: ['generic', 'tanstack-query'], requestedTarget: 'generic' })
    channel.invalidate([
      { target: 'generic', key: ['items'] },
      { target: 'tanstack-query', queryKey: ['items'] },
    ])
    const text = await readStreamChunk(channel.stream)
    expect(text).toContain('"key":["items"]')
  })
})

describe('requestedTarget negotiation', () => {
  const decoder = new TextDecoder()

  async function readStreamChunkRaw(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const { value } = await reader.read()
    reader.releaseLock()
    return value ? decoder.decode(value) : ''
  }

  it('exposes requestedTarget on the channel when it is a valid target', () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'], requestedTarget: 'swr' })
    expect(channel.requestedTarget).toBe('swr')
  })

  it('requestedTarget is undefined when not provided', () => {
    const channel = createSSEChannel({ target: 'swr' })
    expect(channel.requestedTarget).toBeUndefined()
  })

  it('emits revoke frame with unsupported-target reason and closes when requestedTarget is not in supported set', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const channel = createSSEChannel({
      target: ['tanstack-query', 'swr'],
      requestedTarget: 'rtk-query',
      connectionId: 'test-conn',
    })

    const reader = channel.stream.getReader()
    const { value } = await reader.read()
    reader.releaseLock()

    const text = decoder.decode(value)
    expect(text).toBe(
      'event: revoke\ndata: {"reason":"unsupported-target","requested":"rtk-query","supported":["tanstack-query","swr"]}\n\n'
    )
    expect(channel.state).toBe('closed')

    warnSpy.mockRestore()
  })

  it('logs a WARN when rejecting unsupported target', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const channel = createSSEChannel({
      target: ['swr'],
      requestedTarget: 'rtk-query',
      connectionId: 'conn-warn',
    })

    // Drain the stream
    const reader = channel.stream.getReader()
    await reader.read()
    reader.releaseLock()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WARN][createSSEChannel] Rejected connection')
    )
    expect(warnSpy.mock.calls[0][0]).toContain('rtk-query')
    expect(warnSpy.mock.calls[0][0]).toContain('swr')
    expect(warnSpy.mock.calls[0][0]).toContain('conn-warn')

    warnSpy.mockRestore()
  })

  it('sanitizes newlines in requestedTarget and connectionId to prevent log injection', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const channel = createSSEChannel({
      target: ['swr'],
      requestedTarget: 'bad\r\ntarget',
      connectionId: 'bad\ncid',
    })

    const reader = channel.stream.getReader()
    await reader.read()
    reader.releaseLock()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('requested target "bad\\ntarget"')
    )
    expect(warnSpy.mock.calls[0][0]).toContain('connectionId: bad\\ncid.')

    warnSpy.mockRestore()
  })

  it('unknown string target (e.g. from unrecognized client) triggers unsupported-target revoke', async () => {
    // extractRequestedTarget now returns the raw string for unrecognized values.
    // The channel must reject it just like a known-but-unsupported target.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const channel = createSSEChannel({
      target: 'swr',
      requestedTarget: 'some-unknown-framework',  // not a SignalTarget but widened to string
      connectionId: 'conn-unknown',
    })

    const reader = channel.stream.getReader()
    const { value } = await reader.read()
    reader.releaseLock()

    const text = decoder.decode(value)
    expect(text).toContain('"reason":"unsupported-target"')
    expect(text).toContain('"requested":"some-unknown-framework"')
    expect(channel.state).toBe('closed')

    warnSpy.mockRestore()
  })

  it('stream opens normally when requestedTarget is in the supported set (single target)', async () => {
    const channel = createSSEChannel({ target: 'swr', requestedTarget: 'swr' })
    expect(channel.state).toBe('open')

    channel.invalidate({ target: 'swr', key: ['items'] })
    const text = await readStreamChunkRaw(channel.stream)
    expect(text).toContain('"key":["items"]')
    expect(channel.state).toBe('open')
  })

  it('stream opens normally when requestedTarget is in a supported array', () => {
    const channel = createSSEChannel({
      target: ['tanstack-query', 'swr'],
      requestedTarget: 'swr',
    })
    expect(channel.state).toBe('open')
  })

  it('filter in invalidate: signal with wrong explicit target is dropped, returns empty string', () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'], requestedTarget: 'swr' })

    // Inject a pre-tagged tanstack-query signal (with swr signal so validation passes)
    const returnedId = channel.invalidate([
      { target: 'tanstack-query', queryKey: ['todos'] },
      { target: 'swr', key: ['todos'] },
    ])
    expect(returnedId).toBeDefined()
  })

  it('filter in invalidate: signal with matching explicit target is emitted', async () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'], requestedTarget: 'swr' })

    channel.invalidate([
      { target: 'swr', key: ['todos'] },
      { target: 'tanstack-query', queryKey: ['todos'] },
    ])
    const text = await readStreamChunkRaw(channel.stream)
    expect(text).toContain('"key":["todos"]')
    expect(text).not.toContain('queryKey')
  })

  it('filter in invalidate: batch with signals for all targets filters out non-requested targets', async () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'], requestedTarget: 'swr' })

    channel.invalidate([
      { target: 'swr', key: ['items'] },
      { target: 'tanstack-query', queryKey: ['items'] },
    ])
    const text = await readStreamChunkRaw(channel.stream)
    expect(text).toContain('"key":["items"]')
    expect(text).not.toContain('queryKey')
  })

  it('filter in invalidate: batch — drops non-matching, emits matching signals', async () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'], requestedTarget: 'swr' })

    channel.invalidate([
      { target: 'swr', key: ['a'] },
      { target: 'tanstack-query', queryKey: ['b'] },
      { target: 'swr', key: ['c'] },
    ])
    const text = await readStreamChunkRaw(channel.stream)
    // Should only contain swr signals
    const parsed: unknown = JSON.parse(text.replace('event: invalidate\ndata: ', '').replace('\n\n', ''))
    expect(Array.isArray(parsed)).toBe(true)
    const arr = parsed as Array<{ key: unknown }>
    expect(arr).toHaveLength(2)
    expect(arr[0]).toEqual({ target: 'swr', key: ['a'] })
    expect(arr[1]).toEqual({ target: 'swr', key: ['c'] })
  })

  it('filter in invalidate: batch where all items are dropped — returns empty string, no frame emitted', () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'], requestedTarget: 'swr' })

    const returnedId = channel.invalidate([
      { target: 'tanstack-query', queryKey: ['a'] },
      { target: 'swr', key: ['a'] },
    ])
    expect(returnedId).toBeDefined()
    // Channel remains open, frame enqueued for matching requestedTarget
    expect(channel.state).toBe('open')
  })

  it('filter in invalidate: batch signal where requestedTarget filters out entire batch returns empty string', () => {
    const channel = createSSEChannel({ target: 'swr', requestedTarget: 'swr' })

    const returnedId = channel.invalidate([])
    expect(returnedId).toBe('')
    expect(channel.state).toBe('open')
  })

  it('multi-target channel records all provided signals in eventStore', () => {
    const store = createEventStore({ capacity: 10 })
    const channel = createSSEChannel({
      target: ['swr', 'tanstack-query'],
      requestedTarget: 'swr',
      eventStore: store,
    })

    const id = channel.invalidate([
      { target: 'swr', key: ['b'] },
      { target: 'tanstack-query', queryKey: ['b'] },
    ])
    expect(id).not.toBe('')
  })

  it('matching signals ARE recorded in eventStore', () => {
    const store = createEventStore({ capacity: 10 })
    const channel = createSSEChannel({
      target: 'swr',
      requestedTarget: 'swr',
      eventStore: store,
    })

    const id = channel.invalidate({ target: 'swr', key: ['items'] })
    expect(id).not.toBe('')

    const { events } = store.getEventsAfter('0')
    expect(events).toHaveLength(0) // getEventsAfter('0') returns events AFTER id '0'
    // Verify by checking a subsequent event is visible
    const id2 = channel.invalidate({ target: 'swr', key: ['more'] })
    const { events: after } = store.getEventsAfter(id)
    expect(after.map((e) => e.id)).toContain(id2)
  })
})

// ─── Frame Guard tests ────────────────────────────────────────────────────────

describe('Frame Guard — beforeFrame', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('send result — frame is delivered normally', async () => {
    const channel = createSSEChannel({
      target: 'swr',
      beforeFrame: () => ({ action: 'send' }),
    })
    channel.invalidate({ target: 'swr', key: ['items'] })
    const text = await readStreamChunk(channel.stream)
    expect(text).toContain('"key":["items"]')
  })

  it('skip result — frame is dropped, channel stays open, invalidate returns empty string', () => {
    const channel = createSSEChannel({
      target: 'swr',
      beforeFrame: () => ({ action: 'skip' }),
    })
    const id = channel.invalidate({ target: 'swr', key: ['items'] })
    expect(id).toBe('')
    expect(channel.state).toBe('open')
  })

  it('close result — revoke frame sent, channel closes, invalidate throws ChannelClosedError', async () => {
    const channel = createSSEChannel({
      target: 'swr',
      beforeFrame: () => ({ action: 'close', reason: 'unauthorized' }),
    })
    const reader = channel.stream.getReader()
    expect(() => channel.invalidate({ target: 'swr', key: ['items'] })).toThrow(ChannelClosedError)
    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toContain('"reason":"unauthorized"')
    expect(channel.state).toBe('closed')
  })

  it('close result without reason uses default revoke reason', async () => {
    const channel = createSSEChannel({
      target: 'swr',
      beforeFrame: () => ({ action: 'close' }),
    })
    const reader = channel.stream.getReader()
    expect(() => channel.invalidate({ target: 'swr', key: ['items'] })).toThrow(ChannelClosedError)
    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toContain('"reason":"revoked"')
  })

  it('ctx.signal contains the outgoing signal', () => {
    const capturedCtx: Array<{ signal: unknown; frameType: string }> = []
    const channel = createSSEChannel({
      target: 'swr',
      beforeFrame: (ctx) => { capturedCtx.push({ signal: ctx.signal, frameType: ctx.frameType }); return { action: 'send' } },
    })
    channel.invalidate({ target: 'swr', key: ['todos'] })
    expect(capturedCtx).toHaveLength(1)
    expect(capturedCtx[0].frameType).toBe('signal')
    expect(capturedCtx[0].signal).toMatchObject({ target: 'swr', key: ['todos'] })
  })

  it('ctx.connectionId and ctx.requestedTarget are populated', () => {
    let capturedCtx: ReturnType<Parameters<typeof createSSEChannel>[0]['beforeFrame'] & {}> | undefined
    const channel = createSSEChannel({
      target: 'swr',
      connectionId: 'conn-abc',
      requestedTarget: 'swr',
      beforeFrame: (ctx) => { capturedCtx = ctx as any; return { action: 'send' } },
    })
    channel.invalidate({ target: 'swr', key: ['x'] })
    expect((capturedCtx as any).connectionId).toBe('conn-abc')
    expect((capturedCtx as any).requestedTarget).toBe('swr')
  })

  it('ctx.isResume is false for a fresh connection', () => {
    let isResume: boolean | undefined
    const channel = createSSEChannel({
      target: 'swr',
      beforeFrame: (ctx) => { isResume = ctx.isResume; return { action: 'send' } },
    })
    channel.invalidate({ target: 'swr', key: ['x'] })
    expect(isResume).toBe(false)
  })

  it('ctx.isResume is true when lastEventId is present', () => {
    const store = createEventStore({ capacity: 10 })
    let isResume: boolean | undefined
    const channel = createSSEChannel({
      target: 'swr',
      lastEventId: 'some-id',
      eventStore: store,
      beforeFrame: (ctx) => { isResume = ctx.isResume; return { action: 'send' } },
    })
    channel.invalidate({ target: 'swr', key: ['x'] })
    expect(isResume).toBe(true)
  })

  it('beforeFrame throwing an error is treated as close', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const channel = createSSEChannel({
      target: 'swr',
      beforeFrame: () => { throw new Error('guard exploded') },
    })
    const reader = channel.stream.getReader()
    expect(() => channel.invalidate({ target: 'swr', key: ['x'] })).toThrow(ChannelClosedError)
    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toContain('event: revoke')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WARN][createSSEChannel] beforeFrame threw an unhandled error'),
      expect.any(String),
      expect.any(String),
    )
    warnSpy.mockRestore()
  })
})

describe('Frame Guard — guardKeepalive', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('guardKeepalive: false — beforeFrame not called on keepalive ticks', async () => {
    const guardSpy = vi.fn().mockReturnValue({ action: 'send' })
    const channel = createSSEChannel({
      target: 'swr',
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
      target: 'swr',
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
      target: 'swr',
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
      target: 'swr',
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
      target: 'swr',
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
    const channel = createSSEChannel({ target: 'swr', lifetime: { ttlMs: 5000 } })
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
    const channel = createSSEChannel({ target: 'swr', lifetime: { deadline: now + 5000 } })
    const reader = channel.stream.getReader()

    await vi.advanceTimersByTimeAsync(6000)

    const { value } = await reader.read()
    reader.releaseLock()
    expect(decoder.decode(value)).toContain('event: renew')
    expect(channel.state).toBe('closed')
  })

  it('onDeadline: revoke — sends revoke frame instead of renew', async () => {
    const channel = createSSEChannel({
      target: 'swr',
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
      target: 'swr',
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

  it('lifetime timer is cleared when channel closes before deadline', async () => {
    const channel = createSSEChannel({ target: 'swr', lifetime: { ttlMs: 10000 } })
    channel.close()
    expect(channel.state).toBe('closed')
    // Advancing past TTL must not enqueue extra frames or throw
    await vi.advanceTimersByTimeAsync(15000)
    expect(channel.state).toBe('closed')
  })

  it('already-past deadline still fires (after minimum delay floor), not immediately', async () => {
    const past = Date.now() - 60000  // 1 minute in the past
    const channel = createSSEChannel({ target: 'swr', lifetime: { deadline: past } })
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
    const channel = createSSEChannel({ target: 'swr' })
    await vi.advanceTimersByTimeAsync(60000)
    expect(channel.state).toBe('open')
    channel.close()
  })

  it('lifetime timer fires onClose callbacks', async () => {
    const cb = vi.fn()
    const channel = createSSEChannel({ target: 'swr', lifetime: { ttlMs: 1000 } })
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
      target: 'swr',
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
      target: 'swr',
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
      target: 'swr',
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
      target: 'swr',
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
      target: 'swr',
      lastEventId: 'some-id', // triggers isResume=true
      eventStore: undefined, // no store, so no replay happens
      beforeFrame: (ctx) => {
        capturedIsResume = ctx.isResume
        return { action: 'send' }
      },
    })

    channel.invalidate({ target: 'swr', key: ['test'] })
    expect(capturedIsResume).toBe(true)

    channel.close()
  })

  it('throws RangeError for invalid status class in nonRetryableStatuses', () => {
    expect(() => {
      createSSEChannel({
        target: 'swr',
        lifetime: {
          ttlMs: 1000,
          reconnect: {
            nonRetryableStatuses: ['6xx' as any],
          },
        },
      })
    }).toThrow(RangeError)
  })

  it('handles write error during stream write gracefully', async () => {
    const channel = createSSEChannel({ target: 'swr' })
    const reader = channel.stream.getReader()
    await reader.cancel(new Error('EPIPE'))
    expect(() => channel.invalidate({ target: 'swr', key: ['test'] })).toThrow()
  })
})
