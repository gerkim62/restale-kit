import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSEChannel, processTargetSignals } from './channel.js'
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
    const channel = createSSEChannel()
    expect(channel.state).toBe('open')
  })

  it('closes idempotently and sets state to closed', () => {
    const channel = createSSEChannel()
    channel.close()
    expect(channel.state).toBe('closed')
    channel.close() // should not throw
    expect(channel.state).toBe('closed')
  })

  it('disconnect calls close idempotently', () => {
    const channel = createSSEChannel()
    channel.disconnect()
    expect(channel.state).toBe('closed')
  })

  it('throws ChannelClosedError on invalidate when closed', () => {
    const channel = createSSEChannel()
    channel.close()
    expect(() => channel.invalidate({ key: ['test'] })).toThrow(ChannelClosedError)
  })

  it('validates signals against signalSchema before enqueuing batch', () => {
    const schema = createInvalidSchema('Invalid key')
    const channel = createSSEChannel({ signalSchema: schema })

    expect(() => channel.invalidate([{ key: ['valid'] }, { key: ['invalid'] }])).toThrow(
      SchemaValidationError
    )
  })

  it('enqueues framed invalidate event bytes into stream', async () => {
    const channel = createSSEChannel()
    channel.invalidate({ key: ['items', 1] })

    const text = await readStreamChunk(channel.stream)
    expect(text).toBe('event: invalidate\ndata: {"key":["items",1]}\n\n')
  })

  it('does not emit keepalives by default when keepaliveIntervalMs is omitted', async () => {
    const channel = createSSEChannel()
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

  it('replays missed events upon stream initialization if lastEventId and eventStore are set', async () => {
    const store = createEventStore({ capacity: 10 })
    store.add({ key: ['a'] }, 'evt-1')
    store.add({ key: ['b'] }, 'evt-2')
    store.add({ key: ['c'] }, 'evt-3')

    const channel = createSSEChannel({
      lastEventId: 'evt-1',
      eventStore: store,
    })

    const reader = channel.stream.getReader()
    const { value: v1 } = await reader.read()
    const { value: v2 } = await reader.read()
    reader.releaseLock()
    

    expect(decoder.decode(v1)).toBe('id: evt-2\nevent: invalidate\ndata: {"key":["b"]}\n\n')
    expect(decoder.decode(v2)).toBe('id: evt-3\nevent: invalidate\ndata: {"key":["c"]}\n\n')
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

  it('includes customId in SSE stream frame even when channel has no eventStore', async () => {
    const channel = createSSEChannel()
    const returnedId = channel.invalidate({ key: ['items', 1] }, 'custom-evt-99')

    expect(returnedId).toBe('custom-evt-99')
    const text = await readStreamChunk(channel.stream)
    expect(text).toBe('id: custom-evt-99\nevent: invalidate\ndata: {"key":["items",1]}\n\n')
  })

  it('uses idGenerator to produce SSE stream frame id when channel has no eventStore', async () => {
    const customGen = vi.fn().mockReturnValue('gen-id-456')
    const channel = createSSEChannel({ idGenerator: customGen })

    const returnedId = channel.invalidate({ key: ['items', 2] })

    expect(returnedId).toBe('gen-id-456')
    const text = await readStreamChunk(channel.stream)
    expect(text).toBe('id: gen-id-456\nevent: invalidate\ndata: {"key":["items",2]}\n\n')
  })

  it('warns when controller.close throws inside closeInternal', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const channel = createSSEChannel()

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

    const channel = createSSEChannel({ signalSchema: schema as any })
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
    const channel = createSSEChannel({ lastEventId: 'id-1', eventStore: store })
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
      const channel = createSSEChannel()
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
    const channel = createSSEChannel()
    expect(channel.connectionId).toBe('')
  })

  it('revoke() sends a revoke frame then closes the channel', async () => {
    const channel = createSSEChannel()
    const reader = channel.stream.getReader()

    channel.revoke()

    const { value } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(value)).toBe('event: revoke\ndata: {"reason":"revoked"}\n\n')
    expect(channel.state).toBe('closed')
  })

  it('revoke() sends a revoke frame with a custom reason', async () => {
    const channel = createSSEChannel()
    const reader = channel.stream.getReader()

    channel.revoke('logout')

    const { value } = await reader.read()
    reader.releaseLock()

    expect(decoder.decode(value)).toBe('event: revoke\ndata: {"reason":"logout"}\n\n')
    expect(channel.state).toBe('closed')
  })

  it('revoke() is idempotent — no-op when already closed', () => {
    const channel = createSSEChannel()
    channel.close()
    expect(() => { channel.revoke() }).not.toThrow()
    expect(channel.state).toBe('closed')
  })

  it('revoke() fires onClose callbacks', () => {
    const channel = createSSEChannel()
    const cb = vi.fn()
    channel.onClose(cb)

    channel.revoke()

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose fires callback when channel is closed', () => {
    const channel = createSSEChannel()
    const cb = vi.fn()
    channel.onClose(cb)
    expect(cb).not.toHaveBeenCalled()
    channel.close()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose fires immediately if channel is already closed', () => {
    const channel = createSSEChannel()
    channel.close()
    const cb = vi.fn()
    channel.onClose(cb)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose fires on disconnect', () => {
    const channel = createSSEChannel()
    const cb = vi.fn()
    channel.onClose(cb)
    channel.disconnect()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onClose does not fire twice if close is called twice', () => {
    const channel = createSSEChannel()
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
      { queryKey: ['prefer-this'], key: ['not-this'] } as any,
      'swr'
    ) as any
    expect(result.key).toEqual(['prefer-this'])
  })

  it('builds SWR signal: preserves string key as-is', () => {
    const result = processTargetSignals({ key: '/api/users' } as any, 'swr') as any
    expect(result.key).toBe('/api/users')
  })

  it('builds SWR signal: propagates optional action field', () => {
    const result = processTargetSignals(
      { key: ['todos'], action: 'revalidate' } as any,
      'swr'
    ) as any
    expect(result.action).toBe('revalidate')
  })

  it('builds SWR signal: propagates purge action', () => {
    const result = processTargetSignals(
      { key: ['todos'], action: 'purge' } as any,
      'swr'
    ) as any
    expect(result.action).toBe('purge')
  })

  it('builds SWR signal: propagates remove action', () => {
    const result = processTargetSignals(
      { key: ['todos'], action: 'remove' } as any,
      'swr'
    ) as any
    expect(result.action).toBe('remove')
  })

  it('builds SWR signal: propagates revalidate: false', () => {
    const result = processTargetSignals(
      { key: ['todos'], revalidate: false } as any,
      'swr'
    ) as any
    expect(result.revalidate).toBe(false)
  })

  it('builds SWR signal: propagates match field (exact)', () => {
    const result = processTargetSignals(
      { key: ['todos'], match: 'exact' } as any,
      'swr'
    ) as any
    expect(result.match).toBe('exact')
  })

  it('builds SWR signal: propagates match field (prefix)', () => {
    const result = processTargetSignals(
      { key: ['todos'], match: 'prefix' } as any,
      'swr'
    ) as any
    expect(result.match).toBe('prefix')
  })

  it('builds SWR signal: does NOT propagate unknown action values', () => {
    const result = processTargetSignals(
      { key: ['todos'], action: 'unknown-action' } as any,
      'swr'
    ) as any
    expect(result.action).toBeUndefined()
  })

  it('builds SWR signal: does NOT propagate revalidate when it is not a boolean', () => {
    const result = processTargetSignals(
      { key: ['todos'], revalidate: 'yes' } as any,
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
      { queryKey: ['prefer'], key: ['other'] } as any,
      'tanstack-query'
    ) as any
    expect(result.queryKey).toEqual(['prefer'])
  })

  it('builds TanStackQuerySignal: propagates exact boolean', () => {
    const result = processTargetSignals(
      { key: ['todos'], exact: true } as any,
      'tanstack-query'
    ) as any
    expect(result.exact).toBe(true)
  })

  it('builds TanStackQuerySignal: propagates type filter (active/inactive/all)', () => {
    for (const t of ['active', 'inactive', 'all'] as const) {
      const result = processTargetSignals({ key: ['todos'], type: t } as any, 'tanstack-query') as any
      expect(result.type).toBe(t)
    }
  })

  it('builds TanStackQuerySignal: propagates all valid action values', () => {
    for (const action of ['invalidate', 'refetch', 'reset', 'remove', 'cancel'] as const) {
      const result = processTargetSignals({ key: ['todos'], action } as any, 'tanstack-query') as any
      expect(result.action).toBe(action)
    }
  })

  it('builds TanStackQuerySignal: propagates stale boolean', () => {
    const result = processTargetSignals(
      { key: ['todos'], stale: true } as any,
      'tanstack-query'
    ) as any
    expect(result.stale).toBe(true)
  })

  it('builds TanStackQuerySignal: does NOT propagate non-boolean exact', () => {
    const result = processTargetSignals(
      { key: ['todos'], exact: 'yes' } as any,
      'tanstack-query'
    ) as any
    expect(result.exact).toBeUndefined()
  })

  it('builds TanStackQuerySignal: does NOT propagate unknown type value', () => {
    const result = processTargetSignals(
      { key: ['todos'], type: 'unknown' } as any,
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
      { key: [], tags: ['Todo', 'Post'] } as any,
      'rtk-query'
    ) as any
    expect(result.tags).toEqual(['Todo', 'Post'])
  })

  it('builds RTKQuerySignal with object tags that have a numeric id', () => {
    const result = processTargetSignals(
      { key: [], tags: [{ type: 'Todo', id: 42 }] } as any,
      'rtk-query'
    ) as any
    expect(result.tags).toEqual([{ type: 'Todo', id: 42 }])
  })

  it('builds RTKQuerySignal with object tags that have a string id', () => {
    const result = processTargetSignals(
      { key: [], tags: [{ type: 'User', id: 'abc' }] } as any,
      'rtk-query'
    ) as any
    expect(result.tags).toEqual([{ type: 'User', id: 'abc' }])
  })

  it('builds RTKQuerySignal: omits id from tag object when id is absent', () => {
    const result = processTargetSignals(
      { key: [], tags: [{ type: 'Post' }] } as any,
      'rtk-query'
    ) as any
    expect(result.tags).toEqual([{ type: 'Post' }])
    expect('id' in result.tags[0]).toBe(false)
  })

  it('builds RTKQuerySignal: skips non-string/non-record items in tags array', () => {
    const result = processTargetSignals(
      { key: [], tags: [42, null, { type: 'Valid' }] } as any,
      'rtk-query'
    ) as any
    // 42 and null are skipped; only the valid object tag is included
    expect(result.tags).toEqual([{ type: 'Valid' }])
  })

  it('builds RTKQuerySignal: skips tag objects whose type is not a string', () => {
    const result = processTargetSignals(
      { key: [], tags: [{ type: 42 }, { type: 'Good' }] } as any,
      'rtk-query'
    ) as any
    expect(result.tags).toEqual([{ type: 'Good' }])
  })

  it('builds RTKQuerySignal: treats non-array tags as empty', () => {
    const result = processTargetSignals(
      { key: [], tags: 'not-an-array' } as any,
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
      { key: ['todos'], exact: true } as any,
      'generic'
    ) as any
    expect(result.exact).toBe(true)
  })

  it('builds GenericInvalidateSignal: does NOT propagate non-boolean exact', () => {
    const result = processTargetSignals(
      { key: ['todos'], exact: 'yes' } as any,
      'generic'
    ) as any
    expect(result.exact).toBeUndefined()
  })

  it('builds GenericInvalidateSignal: propagates valid action values', () => {
    for (const action of ['invalidate', 'refetch', 'remove'] as const) {
      const result = processTargetSignals({ key: ['todos'], action } as any, 'generic') as any
      expect(result.action).toBe(action)
    }
  })

  it('builds GenericInvalidateSignal: does NOT propagate unknown action', () => {
    const result = processTargetSignals(
      { key: ['todos'], action: 'unknown' } as any,
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
    channel.invalidate({ key: [], tags: [{ type: 'Todo' }] } as any)
    const text = await readStreamChunk(channel.stream)
    expect(text).toContain('"target":"swr"')
    expect(text).toContain('"target":"rtk-query"')
    expect(text).toContain('"tags":[{"type":"Todo"}]')
  })

  it('includes generic target in multi-target fan-out', async () => {
    const channel = createSSEChannel({ target: ['generic', 'tanstack-query'] })
    channel.invalidate({ key: ['items'] } as any)
    const text = await readStreamChunk(channel.stream)
    expect(text).toContain('"target":"generic"')
    expect(text).toContain('"target":"tanstack-query"')
  })
})
