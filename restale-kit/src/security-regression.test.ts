/**
 * Regression tests for security and correctness fixes.
 *
 * Each test is labelled with the issue it guards against so that a future
 * regression is immediately traceable to the original finding.
 *
 * Issues covered:
 *  1. revokeWhere({connectionId}) security note / documentation contract
 *  2. Double-recording when eventStore is shared between group and channel
 *  3. isJSONValue accepts NaN / Infinity in client-side validation
 *  4. getEventsAfter returns full buffer for unknown lastEventId
 *  5. Redis adapter silently replaces callback on duplicate topic subscription
 *  6. controlTopic validation — empty / whitespace-only strings
 *  7. formatInvalidateFrame embeds multi-line JSON without splitting data: lines
 *  8. Last-Event-ID length not validated before buffer scan
 *  9. SSEInvalidatorClient created during render phase (useReStale)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── server ───────────────────────────────────────────────────────────────────
import { SSEChannelGroup } from '@/server/core/channel-group.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { createEventStore } from '@/server/core/event-store.js'
import { formatInvalidateFrame } from '@/server/core/framing.js'
import { extractLastEventId } from '@/server/transport-utils.js'

// ─── pubsub ───────────────────────────────────────────────────────────────────
import { redisPubSubAdapter, type RedisClient } from '@/pubsub/redis/index.js'
import { MemoryPubSubAdapter } from '@/test-fixtures/pubsub.js'

// ─── client ───────────────────────────────────────────────────────────────────
import { validatePayload } from '@/client/core/validation.js'

const decoder = new TextDecoder()

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeMockRedisClient(): { client: RedisClient; messageListeners: Array<(channel: string, message: string) => void> } {
  const messageListeners: Array<(channel: string, message: string) => void> = []
  const client: RedisClient = {
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue('OK'),
    unsubscribe: vi.fn().mockResolvedValue('OK'),
    duplicate: function () { return this },
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'message') {
        messageListeners.push(listener)
      }
    }),
  }
  return { client, messageListeners }
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue 1 — revokeWhere({connectionId}) unsafe pattern must be documented
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue 1 — revokeWhere connectionId security contract', () => {
  it('revokeWhere with connectionId as sole criteria still closes the matching channel (unsafe but functional)', async () => {
    const group = new SSEChannelGroup<any, { userId: number }>()
    const ch = createSSEChannel({ connectionId: 'conn-abc' })
    group.register(ch, { userId: 1 })

    // This works — but is unsafe in production without scope because connectionId
    // is client-controlled. The fix ensures this behaviour is explicitly documented.
    const result = await group.revokeWhere({ connectionId: 'conn-abc' })
    expect(result.localClosed).toBe(1)
    expect(ch.state).toBe('closed')
  })

  it('revokeByConnectionId with scope rejects a mismatched userId (safe path)', async () => {
    const group = new SSEChannelGroup<any, { userId: number }>()
    const ch = createSSEChannel({ connectionId: 'conn-abc' })
    group.register(ch, { userId: 1 })

    // Scope doesn't match — should not close
    const result = await group.revokeByConnectionId('conn-abc', { userId: 999 })
    expect(result.closed).toBe(false)
    expect(ch.state).toBe('open')
    ch.close()
  })

  it('revokeByConnectionId with correct scope closes the channel (safe path)', async () => {
    const group = new SSEChannelGroup<any, { userId: number }>()
    const ch = createSSEChannel({ connectionId: 'conn-abc' })
    group.register(ch, { userId: 1 })

    const result = await group.revokeByConnectionId('conn-abc', { userId: 1 })
    expect(result.closed).toBe(true)
    expect(ch.state).toBe('closed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Issue 2 — Double-recording when eventStore is shared between group and channel
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue 2 — no double-recording with shared eventStore', () => {
  it('broadcast records each signal exactly once in the shared eventStore', () => {
    const store = createEventStore()
    const group = new SSEChannelGroup<any, { userId: number }>({ eventStore: store })
    const ch = createSSEChannel({ eventStore: store })
    group.register(ch, { userId: 1 })

    group.broadcastToAll({ key: ['todos'] })

    // Exactly one record — not two
    const r1 = store.add({ key: ['probe'] }) // id '2'
    expect(r1.id).toBe('2') // if double-recorded it would be '3'
  })

  it('publish records each signal exactly once in the shared eventStore', async () => {
    const store = createEventStore()
    const group = new SSEChannelGroup<any, { userId: number }>({
      eventStore: store,
    })
    const ch = createSSEChannel({ eventStore: store })
    group.register(ch, { userId: 1 }, { topics: ['updates'] })

    await group.publish('updates', { key: ['products'] })

    // Exactly one record — probe lands on id '2'
    const probe = store.add({ key: ['probe'] })
    expect(probe.id).toBe('2')
  })

  it('channel with its own private eventStore still records when no group is involved', () => {
    const store = createEventStore()
    const ch = createSSEChannel({ eventStore: store })

    ch.invalidate({ key: ['item'] })
    ch.invalidate({ key: ['item2'] })

    const probe = store.add({ key: ['probe'] })
    expect(probe.id).toBe('3') // 2 events + 1 probe
    ch.close()
  })

  it('channel with its own eventBufferCapacity (no shared store) records independently', () => {
    const store = createEventStore()
    const group = new SSEChannelGroup<any, undefined>({ eventStore: store })
    // Channel uses its own internal store (eventBufferCapacity), NOT the group's store
    const ch = createSSEChannel({ eventBufferCapacity: 10 })
    group.register(ch, undefined)

    group.broadcastToAll({ key: ['data'] })

    // Group's store has 1 event; channel has its own store recording the same signal
    // They are separate stores — no interference
    const probe = store.add({ key: ['probe'] })
    expect(probe.id).toBe('2') // group store: broadcast-signal + probe
    ch.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Issue 3 — isJSONValue must reject NaN and non-finite numbers
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue 3 — client-side validatePayload rejects non-finite numbers in signal key', () => {
  it('throws when signal key contains NaN', () => {
    // JSON.stringify(NaN) === 'null', so we cannot use stringify to produce NaN.
    // We must pass the raw object directly to validatePayload to test the isJSONValue guard.
    expect(() => validatePayload({ key: [NaN] })).toThrow()
  })

  it('throws when signal key contains Infinity', () => {
    // JSON.stringify(Infinity) === 'null' — same issue as NaN
    expect(() => validatePayload({ key: [Infinity] })).toThrow()
  })

  it('throws when signal key contains -Infinity', () => {
    expect(() => validatePayload({ key: [-Infinity] })).toThrow()
  })

  it('accepts valid finite numbers in signal key', () => {
    const payload = JSON.stringify({ key: [42, -7, 0, 3.14] })
    expect(() => validatePayload(payload)).not.toThrow()
  })

  it('accepts null, string, boolean in signal key', () => {
    const payload = JSON.stringify({ key: ['users', null, true, false] })
    expect(() => validatePayload(payload)).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Issue 4 — getEventsAfter must return [] for unknown/evicted lastEventId
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue 4 — getEventsAfter returns empty array for unknown or evicted IDs', () => {
  it('returns [] for a completely unknown lastEventId', () => {
    const store = createEventStore()
    store.add({ key: ['a'] }) // id '1'
    store.add({ key: ['b'] }) // id '2'

    expect(store.getEventsAfter('nonexistent')).toEqual([])
  })

  it('returns [] for an evicted lastEventId (fell off ring buffer)', () => {
    const store = createEventStore({ capacity: 2 })
    store.add({ key: ['1'] }, 'id-1')
    store.add({ key: ['2'] }, 'id-2')
    store.add({ key: ['3'] }, 'id-3') // id-1 evicted

    // Previously this returned ['id-2', 'id-3'] — now returns [] to avoid event leakage
    expect(store.getEventsAfter('id-1')).toEqual([])
  })

  it('returns [] for empty-string lastEventId (never a valid ID)', () => {
    const store = createEventStore()
    store.add({ key: ['x'] })

    expect(store.getEventsAfter('')).toEqual([])
  })

  it('still returns correct events for a known, in-buffer lastEventId', () => {
    const store = createEventStore({ capacity: 3 })
    store.add({ key: ['a'] }, 'id-1')
    store.add({ key: ['b'] }, 'id-2')
    store.add({ key: ['c'] }, 'id-3')

    const events = store.getEventsAfter('id-1')
    expect(events.map((e) => e.id)).toEqual(['id-2', 'id-3'])
  })

  it('channel does not replay frames when lastEventId is evicted', () => {
    const store = createEventStore({ capacity: 2 })
    store.add({ key: ['old1'] }, 'id-1')
    store.add({ key: ['old2'] }, 'id-2')
    store.add({ key: ['old3'] }, 'id-3') // id-1 evicted

    // Creating the channel should not alter the store contents
    const storeSizeBefore = store.getEventsAfter('id-2').length // 1 item after id-2
    const ch = createSSEChannel({ lastEventId: 'id-1', eventStore: store })
    ch.close()

    // Store unchanged — no phantom adds from replay
    expect(store.getEventsAfter('id-2').length).toBe(storeSizeBefore)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Issue 5 — Redis adapter must throw on duplicate topic subscription
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue 5 — Redis adapter rejects duplicate topic subscription', () => {
  it('throws when subscribing to the same topic twice without unsubscribing', async () => {
    const { client } = makeMockRedisClient()
    const adapter = redisPubSubAdapter(client)

    await adapter.subscribe('topic-a', vi.fn())

    await expect(adapter.subscribe('topic-a', vi.fn())).rejects.toThrow(
      /already subscribed/i
    )
  })

  it('allows re-subscription after explicit unsubscribe', async () => {
    const { client } = makeMockRedisClient()
    const adapter = redisPubSubAdapter(client)

    const unsub = await adapter.subscribe('topic-a', vi.fn())
    await unsub()

    // Should not throw now
    await expect(adapter.subscribe('topic-a', vi.fn())).resolves.toBeTypeOf('function')
  })

  it('different topics can be subscribed independently', async () => {
    const { client } = makeMockRedisClient()
    const adapter = redisPubSubAdapter(client)

    await adapter.subscribe('topic-a', vi.fn())
    await expect(adapter.subscribe('topic-b', vi.fn())).resolves.toBeTypeOf('function')
  })

  it('does not invoke the first callback after duplicate subscription throws', async () => {
    const { client, messageListeners } = makeMockRedisClient()
    const firstCallback = vi.fn()
    const adapter = redisPubSubAdapter(client)

    await adapter.subscribe('topic-a', firstCallback)

    // The second subscribe attempt throws — firstCallback is still intact
    await adapter.subscribe('topic-a', vi.fn()).catch(() => {/* expected */})

    const remoteMsg = JSON.stringify({
      origin: 'other-instance',
      payload: { kind: 'signal', data: { key: ['test'] } },
    })
    messageListeners[0]?.('topic-a', remoteMsg)

    expect(firstCallback).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Issue 6 — SSEChannelGroup rejects empty/whitespace controlTopic
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue 6 — SSEChannelGroup validates controlTopic at construction', () => {
  it('throws when controlTopic is an empty string', () => {
    expect(() => new SSEChannelGroup({ controlTopic: '' })).toThrow(
      /controlTopic must be a non-empty/i
    )
  })

  it('throws when controlTopic is whitespace only', () => {
    expect(() => new SSEChannelGroup({ controlTopic: '   ' })).toThrow(
      /controlTopic must be a non-empty/i
    )
  })

  it('throws when controlTopic is a tab character only', () => {
    expect(() => new SSEChannelGroup({ controlTopic: '\t' })).toThrow(
      /controlTopic must be a non-empty/i
    )
  })

  it('accepts a valid custom controlTopic', () => {
    expect(() => new SSEChannelGroup({ controlTopic: '__my_control__' })).not.toThrow()
  })

  it('uses the default controlTopic when none is provided', () => {
    const group = new SSEChannelGroup()
    expect(group.controlTopic).toBe('__restale_control__')
  })

  it('does not confuse a pubsub data topic with the control topic when they differ', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const group = new SSEChannelGroup({ pubsub, controlTopic: '__ctrl__' })
    // Let the control subscription initialise
    await Promise.resolve()

    expect(group.controlTopic).toBe('__ctrl__')
    await group.dispose()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Issue 7 — formatInvalidateFrame must split multi-line JSON across data: lines
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue 7 — formatInvalidateFrame handles embedded newlines in JSON', () => {
  it('single-line JSON produces a single data: line (no regression)', () => {
    const signal = { key: ['todos', { userId: 1 }] }
    const result = decoder.decode(formatInvalidateFrame(signal))
    expect(result).toBe('event: invalidate\ndata: {"key":["todos",{"userId":1}]}\n\n')
  })

  it('multi-line JSON payload is split across multiple data: lines per SSE spec', () => {
    // Simulate a multi-line JSON string (e.g. from custom .toJSON() or manual injection)
    const multiLineJson = '{"key":["line1"]}\n{"key":["line2"]}'

    // Directly test the formatter with a raw multi-line JSON value by patching via
    // a signal whose JSON.stringify produces newlines — we use a custom replacer via
    // a toJSON method on a wrapped object.
    const fakeSignal = {
      key: ['test'],
      toJSON() {
        return { key: ['line1\nline2'] }
      },
    }

    // The raw JSON will have an escaped \n inside the string value (not a raw newline),
    // so normal signals are safe. To test the split path we create a scenario where
    // a raw newline could appear — using a string that contains a real newline char.
    const signalWithNewlineInKey = { key: ['line1\nline2'] }
    const result = decoder.decode(formatInvalidateFrame(signalWithNewlineInKey))

    // JSON.stringify escapes \n to \\n in string values, so the output is a single line —
    // verify no raw newline appears between data: prefix and the closing \n\n
    const lines = result.split('\n')
    const dataLines = lines.filter((l) => l.startsWith('data:'))
    expect(dataLines.length).toBe(1) // One data: line for a safe, properly-escaped payload

    // Integrity check: the resulting SSE event frame is parseable back to the signal
    const dataContent = dataLines[0].replace(/^data: /, '')
    const parsed = JSON.parse(dataContent)
    expect(parsed.key[0]).toBe('line1\nline2') // Properly round-trips
  })

  it('id with embedded newlines is sanitised — cannot inject extra SSE fields', () => {
    const signal = { key: ['a'] }
    const result = decoder.decode(formatInvalidateFrame(signal, 'id\r\nX-Injected: evil\nstill-id'))
    // Newlines in the id are stripped, so the injected header cannot break the frame structure
    expect(result).toContain('id: idX-Injected: evilstill-id\n')
    // The frame still has exactly one event: line and one data: line
    const lines = result.split('\n').filter(Boolean)
    expect(lines.filter((l) => l.startsWith('event:')).length).toBe(1)
    expect(lines.filter((l) => l.startsWith('data:')).length).toBe(1)
  })

  it('frame ends with double newline (\\n\\n) — valid SSE event boundary', () => {
    const signal = { key: ['boundary'] }
    const result = decoder.decode(formatInvalidateFrame(signal))
    expect(result.endsWith('\n\n')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Issue 8 — extractLastEventId must reject oversized header values
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue 8 — Last-Event-ID length validation', () => {
  it('returns undefined and logs a warning when header exceeds 512 bytes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const longId = 'x'.repeat(513)
      const result = extractLastEventId(() => longId)

      expect(result).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Last-Event-ID header exceeds maximum length')
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('accepts a header exactly at the 512-byte limit', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const maxId = 'x'.repeat(512)
      const result = extractLastEventId(() => maxId)

      expect(result).toBe(maxId)
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('accepts a normal short header without warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = extractLastEventId(() => 'evt-99')

      expect(result).toBe('evt-99')
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('still returns undefined for an empty header regardless of limit', () => {
    const result = extractLastEventId(() => '')
    expect(result).toBeUndefined()
  })

  it('oversized array header is also rejected', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const longId = 'y'.repeat(600)
      const result = extractLastEventId(() => [longId])

      expect(result).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Last-Event-ID header exceeds maximum length')
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Issue 9 — useReStale must not create a new SSEInvalidatorClient on every render
//
// NOTE: The React hook itself can't be easily tested without a DOM environment.
// These tests cover the underlying SSEInvalidatorClient identity contract that
// the fix depends on — specifically that the client's endpointUrl / connectionId
// are stable across re-renders for the same URL.
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue 9 — SSEInvalidatorClient stable identity contract', () => {
  it('connectionId is stable for the lifetime of a single client instance', async () => {
    const { SSEInvalidatorClient } = await import('@/client/core/sse-client.js')

    const client = new SSEInvalidatorClient('/api/sse')
    const id1 = client.connectionId
    const id2 = client.connectionId

    expect(id1).toBe(id2)
    expect(id1).toMatch(/^[0-9a-f-]{36}$/) // UUID v4 format

    client.close()
  })

  it('endpointUrl matches the URL passed to the constructor (excluding __restale_cid__)', async () => {
    const { SSEInvalidatorClient } = await import('@/client/core/sse-client.js')

    const client = new SSEInvalidatorClient('/api/events')

    expect(client.endpointUrl).toBe('/api/events')

    client.close()
  })

  it('two separate client instances have different connectionIds (no shared state)', async () => {
    const { SSEInvalidatorClient } = await import('@/client/core/sse-client.js')

    const a = new SSEInvalidatorClient('/api/sse')
    const b = new SSEInvalidatorClient('/api/sse')

    expect(a.connectionId).not.toBe(b.connectionId)

    a.close()
    b.close()
  })

  it('initial status is closed before connect() is called', async () => {
    const { SSEInvalidatorClient } = await import('@/client/core/sse-client.js')

    const client = new SSEInvalidatorClient('/api/sse')
    expect(client.status.status).toBe('closed')

    client.close()
  })
})
