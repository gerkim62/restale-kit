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
})
