import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSEChannel } from './channel.js'
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

  it('emits keepalives at configured interval', async () => {
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
})


