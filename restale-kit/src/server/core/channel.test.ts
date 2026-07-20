import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSEChannel, processTargetSignals } from './channel.js'
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
    expect(() => channel.invalidate({ key: ['test'] })).toThrow(ChannelClosedError)
  })

  it('validates signals against signalSchema before enqueuing batch', () => {
    const schema = createInvalidSchema('Invalid key')
    const channel = createSSEChannel({ target: 'swr', signalSchema: schema })

    expect(() => channel.invalidate([{ key: ['valid'] }, { key: ['invalid'] }])).toThrow(
      SchemaValidationError
    )
  })

  it('enqueues framed invalidate event bytes into stream', async () => {
    const channel = createSSEChannel({ target: 'swr' })
    channel.invalidate({ key: ['items', 1] })

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
    store.add({ key: ['a'] }, 'evt-1')
    store.add({ key: ['b'] }, 'evt-2')
    store.add({ key: ['c'] }, 'evt-3')

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
    const customChannel = createSSEChannel({ target: 'swr', eventBufferCapacity: 10, idGenerator: customGen })

    const generatedId = customChannel.invalidate({ key: ['test-custom'] })
    expect(generatedId).toBe('custom-id-123')
    expect(customGen).toHaveBeenCalled()
  })

  it('includes customId in SSE stream frame even when channel has no eventStore', async () => {
    const channel = createSSEChannel({ target: 'swr' })
    const returnedId = channel.invalidate({ key: ['items', 1] }, 'custom-evt-99')

    expect(returnedId).toBe('custom-evt-99')
    const text = await readStreamChunk(channel.stream)
    expect(text).toBe('id: custom-evt-99\nevent: invalidate\ndata: {"target":"swr","key":["items",1]}\n\n')
  })

  it('uses idGenerator to produce SSE stream frame id when channel has no eventStore', async () => {
    const customGen = vi.fn().mockReturnValue('gen-id-456')
    const channel = createSSEChannel({ target: 'swr', idGenerator: customGen })

    const returnedId = channel.invalidate({ key: ['items', 2] })

    expect(returnedId).toBe('gen-id-456')
    const text = await readStreamChunk(channel.stream)
    expect(text).toBe('id: gen-id-456\nevent: invalidate\ndata: {"target":"swr","key":["items",2]}\n\n')
  })

  it('warns when controller.close throws inside closeInternal', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const channel = createSSEChannel({ target: 'swr' })

    // Cancel reader to trigger cancel callback on stream which closes stream controller
    const reader = channel.stream.getReader()
    await reader.cancel()

    // Calling close after cancel will trigger controller.close error branch in closeInternal
    channel.close()

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WARN][closeInternal] Controller close threw an expected error'),
      '\n  error:',
      expect.any(String)
    )

    consoleSpy.mockRestore()
  })

  it('throws ChannelClosedError BEFORE schema validation when channel is closed', () => {
    const schemaSpy = vi.fn().mockReturnValue({ value: { key: ['test'] } })
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: schemaSpy,
      },
    }

    const channel = createSSEChannel({ target: 'swr', signalSchema: schema as any })
    channel.close()

    // Must throw ChannelClosedError, not SchemaValidationError
    expect(() => channel.invalidate({ key: ['test'] } as any)).toThrow(ChannelClosedError)
    // Schema should never have been consulted
    expect(schemaSpy).not.toHaveBeenCalled()
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
    expect(decoder.decode(value)).toBe('event: invalidate\ndata: {"key":[]}\n\n')

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
    expect(decoder.decode(v1)).toBe('event: invalidate\ndata: {"key":[]}\n\n')
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

  it('warns when controller.close throws an error in closeInternal', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const OriginalReadableStream = globalThis.ReadableStream

    // Intercept controller passed to ReadableStream start
    globalThis.ReadableStream = class extends (OriginalReadableStream as any) {
      constructor(underlyingSource?: any, queuingStrategy?: any) {
        const origStart = underlyingSource?.start
        if (origStart) {
          underlyingSource.start = function (ctrl: any) {
            ctrl.close = () => {
              throw new Error('Controller close stream error')
            }
            return origStart.call(this, ctrl)
          }
        }
        super(underlyingSource, queuingStrategy)
      }
    } as unknown as typeof ReadableStream

    try {
      const channel = createSSEChannel({ target: 'swr' })
      channel.close()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN][closeInternal] Controller close threw an expected error'),
        '\n  error:',
        expect.stringContaining('Controller close stream error')
      )
    } finally {
      globalThis.ReadableStream = OriginalReadableStream
      consoleSpy.mockRestore()
    }
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
    const id = channel.invalidate({ key: ['auto-store'] })
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

    channel.invalidate({ key: ['items', 1] })
    const text = await readStreamChunk(channel.stream)
    expect(text).toBe('event: invalidate\ndata: {"target":"swr","key":["items",1]}\n\n')
  })

  it('natively fans out multi-target array when channel is configured with target array', async () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'] })
    expect(channel.target).toEqual(['swr', 'tanstack-query'])

    channel.invalidate({ key: ['items', 1] })
    const text = await readStreamChunk(channel.stream)
    expect(text).toBe(
      'event: invalidate\ndata: [{"target":"swr","key":["items",1]},{"target":"tanstack-query","queryKey":["items",1]}]\n\n'
    )
  })
})

describe('processTargetSignals', () => {
  // ── return-value shape ──────────────────────────────────────────────────────

  it('returns a single object (not an array) when given a single signal and a single target', () => {
    const result = processTargetSignals({ key: ['todos'] }, 'swr')
    // Must NOT be an array — mirrors the invalidate() overload contract
    expect(Array.isArray(result)).toBe(false)
    expect(result).toMatchObject({ target: 'swr', key: ['todos'] })
  })

  it('returns an array when given a single signal and an array of targets', () => {
    const result = processTargetSignals({ key: ['todos'] }, ['swr', 'tanstack-query'])
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)
  })

  it('returns an array when given a batch of signals with a single target', () => {
    const result = processTargetSignals(
      [{ key: ['a'] }, { key: ['b'] }],
      'tanstack-query'
    )
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)
  })

  it('returns an array when given a batch of signals and a multi-target array', () => {
    const result = processTargetSignals(
      [{ key: ['a'] }, { key: ['b'] }],
      ['swr', 'tanstack-query']
    )
    expect(Array.isArray(result)).toBe(true)
    // 2 signals × 2 targets = 4 entries
    expect(result).toHaveLength(4)
  })

  // ── already-tagged passthrough ─────────────────────────────────────────────

  it('passes through a signal that already has a target property without re-wrapping', () => {
    const tagged = { target: 'swr' as const, key: ['todos'] }
    const result = processTargetSignals(tagged, 'tanstack-query')
    // Should be returned as-is (no re-wrapping in an array since only one result)
    expect(result).toEqual(tagged)
    expect((result as any).target).toBe('swr')
  })

  it('passes through already-tagged signals in a batch', () => {
    const t1 = { target: 'swr' as const, key: ['a'] }
    const t2 = { key: ['b'] }
    const result = processTargetSignals([t1, t2], 'tanstack-query') as any[]
    expect(result[0]).toEqual(t1)
    expect(result[1]).toMatchObject({ target: 'tanstack-query', queryKey: ['b'] })
  })

  // ── SWR target ─────────────────────────────────────────────────────────────

  it('builds SWR signal with array key from generic key field', () => {
    const result = processTargetSignals({ key: ['users', 1] }, 'swr') as any
    expect(result.target).toBe('swr')
    expect(result.key).toEqual(['users', 1])
  })

  it('builds SWR signal: prefers queryKey over key when both present', () => {
    const result = processTargetSignals(
      { queryKey: ['prefer-this'], key: ['not-this'] },
      'swr'
    ) as any
    expect(result.key).toEqual(['prefer-this'])
  })

  it('builds SWR signal: preserves string key as-is', () => {
    const result = processTargetSignals({ key: '/api/users' } as InvalidateSignal, 'swr') as any
    expect(result.key).toBe('/api/users')
  })

  it('builds SWR signal: propagates optional action field', () => {
    const result = processTargetSignals(
      { key: ['todos'], action: 'revalidate' } as InvalidateSignal,
      'swr'
    ) as any
    expect(result.action).toBe('revalidate')
  })

  it('builds SWR signal: propagates purge action', () => {
    const result = processTargetSignals(
      { key: ['todos'], action: 'purge' } as InvalidateSignal,
      'swr'
    ) as any
    expect(result.action).toBe('purge')
  })

  it('builds SWR signal: propagates remove action', () => {
    const result = processTargetSignals(
      { key: ['todos'], action: 'remove' },
      'swr'
    ) as any
    expect(result.action).toBe('remove')
  })

  it('builds SWR signal: propagates revalidate: false', () => {
    const result = processTargetSignals(
      { key: ['todos'], revalidate: false },
      'swr'
    ) as any
    expect(result.revalidate).toBe(false)
  })

  it('builds SWR signal: propagates match field (exact)', () => {
    const result = processTargetSignals(
      { key: ['todos'], match: 'exact' } as InvalidateSignal,
      'swr'
    ) as any
    expect(result.match).toBe('exact')
  })

  it('builds SWR signal: propagates match field (prefix)', () => {
    const result = processTargetSignals(
      { key: ['todos'], match: 'prefix' } as InvalidateSignal,
      'swr'
    ) as any
    expect(result.match).toBe('prefix')
  })

  it('builds SWR signal: does NOT propagate unknown action values', () => {
    const result = processTargetSignals(
      { key: ['todos'], action: 'unknown-action' } as unknown as InvalidateSignal,
      'swr'
    ) as any
    expect(result.action).toBeUndefined()
  })

  it('builds SWR signal: does NOT propagate revalidate when it is not a boolean', () => {
    const result = processTargetSignals(
      { key: ['todos'], revalidate: 'yes' } as InvalidateSignal,
      'swr'
    ) as any
    expect(result.revalidate).toBeUndefined()
  })

  // ── TanStack Query target ──────────────────────────────────────────────────

  it('builds TanStackQuerySignal with queryKey from generic key field', () => {
    const result = processTargetSignals({ key: ['posts', 2] }, 'tanstack-query') as any
    expect(result.target).toBe('tanstack-query')
    expect(result.queryKey).toEqual(['posts', 2])
  })

  it('builds TanStackQuerySignal: prefers queryKey source over key when both present', () => {
    const result = processTargetSignals(
      { queryKey: ['prefer'], key: ['other'] },
      'tanstack-query'
    ) as any
    expect(result.queryKey).toEqual(['prefer'])
  })

  it('builds TanStackQuerySignal: propagates exact boolean', () => {
    const result = processTargetSignals(
      { key: ['todos'], exact: true },
      'tanstack-query'
    ) as any
    expect(result.exact).toBe(true)
  })

  it('builds TanStackQuerySignal: propagates type filter (active/inactive/all)', () => {
    for (const t of ['active', 'inactive', 'all'] as const) {
      const result = processTargetSignals({ key: ['todos'], type: t }, 'tanstack-query') as any
      expect(result.type).toBe(t)
    }
  })

  it('builds TanStackQuerySignal: propagates all valid action values', () => {
    for (const action of ['invalidate', 'refetch', 'reset', 'remove', 'cancel'] as const) {
      const result = processTargetSignals({ key: ['todos'], action } as InvalidateSignal, 'tanstack-query') as any
      expect(result.action).toBe(action)
    }
  })

  it('builds TanStackQuerySignal: propagates stale boolean', () => {
    const result = processTargetSignals(
      { key: ['todos'], stale: true },
      'tanstack-query'
    ) as any
    expect(result.stale).toBe(true)
  })

  it('builds TanStackQuerySignal: does NOT propagate non-boolean exact', () => {
    const result = processTargetSignals(
      { key: ['todos'], exact: 'yes' } as unknown as InvalidateSignal,
      'tanstack-query'
    ) as any
    expect(result.exact).toBeUndefined()
  })

  it('builds TanStackQuerySignal: does NOT propagate unknown type value', () => {
    const result = processTargetSignals(
      { key: ['todos'], type: 'unknown' } as InvalidateSignal,
      'tanstack-query'
    ) as any
    expect(result.type).toBeUndefined()
  })

  // ── RTK Query target ──────────────────────────────────────────────────────

  it('builds RTKQuerySignal with empty tags when no tags field present', () => {
    const result = processTargetSignals({ key: ['todos'] }, 'rtk-query') as any
    expect(result.target).toBe('rtk-query')
    expect(result.tags).toEqual([])
  })

  it('builds RTKQuerySignal with string tags', () => {
    const result = processTargetSignals(
      { key: [], tags: ['Todo', 'Post'] },
      'rtk-query'
    ) as any
    expect(result.tags).toEqual(['Todo', 'Post'])
  })

  it('builds RTKQuerySignal with object tags that have a numeric id', () => {
    const result = processTargetSignals(
      { key: [], tags: [{ type: 'Todo', id: 42 }] },
      'rtk-query'
    ) as any
    expect(result.tags).toEqual([{ type: 'Todo', id: 42 }])
  })

  it('builds RTKQuerySignal with object tags that have a string id', () => {
    const result = processTargetSignals(
      { key: [], tags: [{ type: 'User', id: 'abc' }] },
      'rtk-query'
    ) as any
    expect(result.tags).toEqual([{ type: 'User', id: 'abc' }])
  })

  it('builds RTKQuerySignal: omits id from tag object when id is absent', () => {
    const result = processTargetSignals(
      { key: [], tags: [{ type: 'Post' }] },
      'rtk-query'
    ) as any
    expect(result.tags).toEqual([{ type: 'Post' }])
    expect('id' in result.tags[0]).toBe(false)
  })

  it('builds RTKQuerySignal: skips non-string/non-record items in tags array', () => {
    const result = processTargetSignals(
      { key: [], tags: [42, null, { type: 'Valid' }] } as InvalidateSignal,
      'rtk-query'
    ) as any
    // 42 and null are skipped; only the valid object tag is included
    expect(result.tags).toEqual([{ type: 'Valid' }])
  })

  it('builds RTKQuerySignal: skips tag objects whose type is not a string', () => {
    const result = processTargetSignals(
      { key: [], tags: [{ type: 42 }, { type: 'Good' }] } as InvalidateSignal,
      'rtk-query'
    ) as any
    expect(result.tags).toEqual([{ type: 'Good' }])
  })

  it('builds RTKQuerySignal: treats non-array tags as empty', () => {
    const result = processTargetSignals(
      { key: [], tags: 'not-an-array' } as InvalidateSignal,
      'rtk-query'
    ) as any
    expect(result.tags).toEqual([])
  })

  // ── Generic target ────────────────────────────────────────────────────────

  it('builds GenericInvalidateSignal with key from key field', () => {
    const result = processTargetSignals({ key: ['generic-key'] }, 'generic') as any
    expect(result.target).toBe('generic')
    expect(result.key).toEqual(['generic-key'])
  })

  it('builds GenericInvalidateSignal: propagates exact boolean', () => {
    const result = processTargetSignals(
      { key: ['todos'], exact: true },
      'generic'
    ) as any
    expect(result.exact).toBe(true)
  })

  it('builds GenericInvalidateSignal: does NOT propagate non-boolean exact', () => {
    const result = processTargetSignals(
      { key: ['todos'], exact: 'yes' } as unknown as InvalidateSignal,
      'generic'
    ) as any
    expect(result.exact).toBeUndefined()
  })

  it('builds GenericInvalidateSignal: propagates valid action values', () => {
    for (const action of ['invalidate', 'refetch', 'remove'] as const) {
      const result = processTargetSignals({ key: ['todos'], action }, 'generic') as any
      expect(result.action).toBe(action)
    }
  })

  it('builds GenericInvalidateSignal: does NOT propagate unknown action', () => {
    const result = processTargetSignals(
      { key: ['todos'], action: 'unknown' } as unknown as InvalidateSignal,
      'generic'
    ) as any
    expect(result.action).toBeUndefined()
  })

  // ── Non-plain-object signal ───────────────────────────────────────────────

  it('treats non-record signal as empty raw object (key defaults to [])', () => {
    // A signal that is somehow not an object — raw should be treated as {}
    const result = processTargetSignals('not-an-object' as any, 'swr') as any
    // key defaults to [] because raw has no key/queryKey
    expect(result.key).toEqual([])
  })

  // ── Multi-target wire format on channel.invalidate ─────────────────────────

  it('includes RTK target in multi-target fan-out', async () => {
    const channel = createSSEChannel({ target: ['swr', 'rtk-query'] })
    channel.invalidate({ key: [], tags: [{ type: 'Todo' }] })
    const text = await readStreamChunk(channel.stream)
    expect(text).toContain('"target":"swr"')
    expect(text).toContain('"target":"rtk-query"')
    expect(text).toContain('"tags":[{"type":"Todo"}]')
  })

  it('includes generic target in multi-target fan-out', async () => {
    const channel = createSSEChannel({ target: ['generic', 'tanstack-query'] })
    channel.invalidate({ key: ['items'] })
    const text = await readStreamChunk(channel.stream)
    expect(text).toContain('"target":"generic"')
    expect(text).toContain('"target":"tanstack-query"')
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

    channel.invalidate({ key: ['items'] })
    const text = await readStreamChunkRaw(channel.stream)
    expect(text).toContain('"target":"swr"')
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

    // Inject a pre-tagged tanstack-query signal — should be dropped
    const returnedId = channel.invalidate({ target: 'tanstack-query', queryKey: ['todos'] })
    expect(returnedId).toBe('')
  })

  it('filter in invalidate: signal with matching explicit target is emitted', async () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'], requestedTarget: 'swr' })

    channel.invalidate({ target: 'swr', key: ['todos'] })
    const text = await readStreamChunkRaw(channel.stream)
    expect(text).toContain('"target":"swr"')
    expect(text).not.toContain('"target":"tanstack-query"')
  })

  it('filter in invalidate: untagged signal is stamped with requestedTarget and emitted', async () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'], requestedTarget: 'swr' })

    // Untagged signal — processTargetSignals will produce [swr, tanstack-query]
    // then the filter keeps only swr
    channel.invalidate({ key: ['items'] })
    const text = await readStreamChunkRaw(channel.stream)
    expect(text).toContain('"target":"swr"')
    // tanstack-query version should be filtered out (the emitted payload is a single obj not array)
    expect(text).not.toContain('"target":"tanstack-query"')
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
    const arr = parsed as Array<{ target: string }>
    expect(arr).toHaveLength(2)
    expect(arr[0].target).toBe('swr')
    expect(arr[1].target).toBe('swr')
  })

  it('filter in invalidate: batch where all items are dropped — returns empty string, no frame emitted', () => {
    const channel = createSSEChannel({ target: ['swr', 'tanstack-query'], requestedTarget: 'swr' })

    const returnedId = channel.invalidate([
      { target: 'tanstack-query', queryKey: ['a'] },
      { target: 'rtk-query', tags: [] },
    ])
    expect(returnedId).toBe('')
    // Channel remains open, no frame enqueued
    expect(channel.state).toBe('open')
  })

  it('dropped signals are not recorded in eventStore', () => {
    const store = createEventStore({ capacity: 10 })
    const channel = createSSEChannel({
      target: ['swr', 'tanstack-query'],
      requestedTarget: 'swr',
      eventStore: store,
    })

    channel.invalidate({ target: 'tanstack-query', queryKey: ['b'] })

    // store should have no events recorded
    const { events, stale } = store.getEventsAfter('0')
    expect(stale).toBe(true) // nothing in the store means cursor is unknown
    expect(events).toHaveLength(0)
  })

  it('matching signals ARE recorded in eventStore', () => {
    const store = createEventStore({ capacity: 10 })
    const channel = createSSEChannel({
      target: 'swr',
      requestedTarget: 'swr',
      eventStore: store,
    })

    const id = channel.invalidate({ key: ['items'] })
    expect(id).not.toBe('')

    const { events } = store.getEventsAfter('0')
    expect(events).toHaveLength(0) // getEventsAfter('0') returns events AFTER id '0'
    // Verify by checking a subsequent event is visible
    const id2 = channel.invalidate({ key: ['more'] })
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
    channel.invalidate({ key: ['items'] })
    const text = await readStreamChunk(channel.stream)
    expect(text).toContain('"key":["items"]')
  })

  it('skip result — frame is dropped, channel stays open, invalidate returns empty string', () => {
    const channel = createSSEChannel({
      target: 'swr',
      beforeFrame: () => ({ action: 'skip' }),
    })
    const id = channel.invalidate({ key: ['items'] })
    expect(id).toBe('')
    expect(channel.state).toBe('open')
  })

  it('close result — revoke frame sent, channel closes, invalidate throws ChannelClosedError', async () => {
    const channel = createSSEChannel({
      target: 'swr',
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
      target: 'swr',
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
      target: 'swr',
      beforeFrame: (ctx) => { capturedCtx.push({ signal: ctx.signal, frameType: ctx.frameType }); return { action: 'send' } },
    })
    channel.invalidate({ key: ['todos'] })
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
    channel.invalidate({ key: ['x'] })
    expect((capturedCtx as any).connectionId).toBe('conn-abc')
    expect((capturedCtx as any).requestedTarget).toBe('swr')
  })

  it('ctx.isResume is false for a fresh connection', () => {
    let isResume: boolean | undefined
    const channel = createSSEChannel({
      target: 'swr',
      beforeFrame: (ctx) => { isResume = ctx.isResume; return { action: 'send' } },
    })
    channel.invalidate({ key: ['x'] })
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
    channel.invalidate({ key: ['x'] })
    expect(isResume).toBe(true)
  })

  it('beforeFrame throwing an error is treated as close', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const channel = createSSEChannel({
      target: 'swr',
      beforeFrame: () => { throw new Error('guard exploded') },
    })
    const reader = channel.stream.getReader()
    expect(() => channel.invalidate({ key: ['x'] })).toThrow(ChannelClosedError)
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

  it('schema validation runs before beforeFrame', () => {
    const guardSpy = vi.fn().mockReturnValue({ action: 'send' })
    const channel = createSSEChannel({
      target: 'swr',
      signalSchema: {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate: () => ({ issues: [{ message: 'invalid' }] }),
        },
      },
      beforeFrame: guardSpy,
    })
    expect(() => channel.invalidate({ key: ['x'] } as any)).toThrow()
    expect(guardSpy).not.toHaveBeenCalled()
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

  // FT-06: beforeFrame.close does not take renew path
  it('beforeFrame returns close action when onDeadline is reconnect — sends revoke, not renew', async () => {
    const channel = createSSEChannel({
      target: 'swr',
      lifetime: { ttlMs: 1000, onDeadline: 'reconnect' }, // default: would send renew
      beforeFrame: (ctx) => {
        // On deadline timeout, beforeFrame sees the renew frame about to go out
        // Returning close should skip the renew and go straight to revoke
        if (ctx.frameType === 'signal' && ctx.signal === undefined) {
          return { action: 'close', reason: 'guard-rejected' }
        }
        return { action: 'send' }
      },
    })
    const reader = channel.stream.getReader()

    // Wait past deadline
    await vi.advanceTimersByTimeAsync(2000)

    const { value } = await reader.read()
    reader.releaseLock()

    const text = decoder.decode(value)
    // Should be revoke (from beforeFrame close), not renew
    expect(text).toContain('event: revoke')
    expect(text).toContain('"reason":"guard-rejected"')
    expect(text).not.toContain('event: renew')
    expect(channel.state).toBe('closed')
  })

  // FT-07: isResume with lastEventId but no eventStore
  it('ctx.isResume is true when lastEventId is set even with no eventStore', async () => {
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

    channel.invalidate({ key: ['test'] })
    expect(capturedIsResume).toBe(true)

    channel.close()
  })

