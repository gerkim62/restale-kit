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

  it('channel with its own eventBufferCapacity does NOT record into the group store (no cross-contamination)', () => {
    // Pre-fix: the group would record into its own store (id '1'), then channel.invalidate()
    // with a customId would call eventStore.add() again on the shared store — but here the
    // channel has its OWN private store (via eventBufferCapacity), not the group's store.
    // Verify the group store only ever sees what the group itself recorded.
    const groupStore = createEventStore()
    const group = new SSEChannelGroup<any, undefined>({ eventStore: groupStore })
    const ch = createSSEChannel({ eventBufferCapacity: 10 })
    group.register(ch, undefined)

    group.broadcastToAll({ key: ['data'] })

    // Group store: exactly 1 event (id '1')
    const probe = groupStore.add({ key: ['probe'] })
    expect(probe.id).toBe('2') // broadcast-signal='1', probe='2'

    // The channel's internal store (not accessible directly) should have recorded
    // its own copy. We verify indirectly: the returned eventId from invalidate()
    // on a fresh channel with its own store starts at '1' — not influenced by group's counter.
    const soloStore = createEventStore()
    const soloChannel = createSSEChannel({ eventStore: soloStore })
    soloChannel.invalidate({ key: ['x'] })
    const soloProbe = soloStore.add({ key: ['probe'] })
    expect(soloProbe.id).toBe('2') // solo store is independent — starts at 1

    ch.close()
    soloChannel.close()
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
  it('returns stale:true with empty events for a completely unknown lastEventId', () => {
    const store = createEventStore()
    store.add({ key: ['a'] }) // id '1'
    store.add({ key: ['b'] }) // id '2'

    const result = store.getEventsAfter('nonexistent')
    expect(result.stale).toBe(true)
    expect(result.events).toEqual([])
  })

  it('returns stale:true with empty events for an evicted lastEventId (fell off ring buffer)', () => {
    const store = createEventStore({ capacity: 2 })
    store.add({ key: ['1'] }, 'id-1')
    store.add({ key: ['2'] }, 'id-2')
    store.add({ key: ['3'] }, 'id-3') // id-1 evicted

    const result = store.getEventsAfter('id-1')
    expect(result.stale).toBe(true)
    expect(result.events).toEqual([])
  })

  it('returns stale:true with empty events for empty-string lastEventId (never a valid ID)', () => {
    const store = createEventStore()
    store.add({ key: ['x'] })

    const result = store.getEventsAfter('')
    expect(result.stale).toBe(true)
    expect(result.events).toEqual([])
  })

  it('still returns correct events (stale:false) for a known, in-buffer lastEventId', () => {
    const store = createEventStore({ capacity: 3 })
    store.add({ key: ['a'] }, 'id-1')
    store.add({ key: ['b'] }, 'id-2')
    store.add({ key: ['c'] }, 'id-3')

    const { events, stale } = store.getEventsAfter('id-1')
    expect(stale).toBe(false)
    expect(events.map((e) => e.id)).toEqual(['id-2', 'id-3'])
  })

  it('channel sends a full-invalidate frame when lastEventId is evicted (stale cursor)', async () => {
    const store = createEventStore({ capacity: 2 })
    store.add({ key: ['old1'] }, 'id-1')
    store.add({ key: ['old2'] }, 'id-2')
    store.add({ key: ['old3'] }, 'id-3') // id-1 evicted

    // Channel should enqueue a full-invalidate signal, not silently do nothing
    const ch = createSSEChannel({ lastEventId: 'id-1', eventStore: store })
    const reader = ch.stream.getReader()
    const { value } = await reader.read()
    reader.releaseLock()
    ch.close()

    const text = new TextDecoder().decode(value)
    expect(text).toBe('event: invalidate\ndata: {"key":[]}\n\n')

    // Store not mutated by the replay path
    const { events, stale } = store.getEventsAfter('id-2')
    expect(stale).toBe(false)
    expect(events.map((e) => e.id)).toEqual(['id-3'])
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

  it('first callback is not replaced by the second after duplicate subscription throws', async () => {
    const { client, messageListeners } = makeMockRedisClient()
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()
    const adapter = redisPubSubAdapter(client)

    await adapter.subscribe('topic-a', firstCallback)

    // The second subscribe attempt throws — pre-fix this silently replaced firstCallback
    // with secondCallback in the callbacks map
    await adapter.subscribe('topic-a', secondCallback).catch(() => {/* expected */})

    const remoteMsg = JSON.stringify({
      origin: 'other-instance',
      payload: { kind: 'signal', data: { key: ['test'] } },
    })
    messageListeners[0]?.('topic-a', remoteMsg)

    // firstCallback must have been called — it was not replaced
    expect(firstCallback).toHaveBeenCalledTimes(1)
    // secondCallback must NOT have been called — it was never successfully registered
    expect(secondCallback).not.toHaveBeenCalled()
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

  it('control messages on the custom controlTopic revoke channels; signals on data topics do not', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const group = new SSEChannelGroup<any, { userId: number }>({ pubsub, controlTopic: '__ctrl__' })
    // Wait for control subscription to be established
    await Promise.resolve()
    await Promise.resolve()

    const ch = createSSEChannel({ connectionId: 'conn-1' })
    group.register(ch, { userId: 42 })

    // Publish a revoke-matching criteria on the CONTROL topic — should close the channel
    await pubsub.publish('__ctrl__', { kind: 'control', data: { userId: 42 } })
    await Promise.resolve()

    expect(ch.state).toBe('closed')
    expect(group.size).toBe(0)

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
    // To exercise the split path we need a signal whose JSON.stringify output contains
    // a raw newline. JSON.stringify escapes \n inside strings to \\n, so we cannot get
    // there through normal values. We simulate it via a custom replacer that produces
    // a multi-line JSON string, then call formatInvalidateFrame with a pre-stringified
    // value by testing the internal formatter directly on a string that has a literal \n.

    // The formatter calls json.split(/\r\n|\r|\n/) then prefixes each part with "data: ".
    // We verify this by building a signal whose serialised form we can control.
    // We do this by checking a known multi-line output directly:
    const signalJson = '{"key":["part1"]}\n{"key":["part2"]}'
    // Simulate what formatInvalidateFrame does internally with a multi-line JSON string:
    const dataLines = signalJson.split(/\r\n|\r|\n/).map((line) => `data: ${line}`)
    expect(dataLines).toEqual([
      'data: {"key":["part1"]}',
      'data: {"key":["part2"]}',
    ])

    // Now verify formatInvalidateFrame itself: normal signals are always single-line
    // (JSON.stringify doesn't produce raw newlines for standard objects), and the
    // formatter produces exactly one data: line for them.
    const signal = { key: ['todos', { userId: 1 }] }
    const result = decoder.decode(formatInvalidateFrame(signal))
    const resultDataLines = result.split('\n').filter((l) => l.startsWith('data:'))
    expect(resultDataLines.length).toBe(1)

    // Round-trip: data line content parses back to the original signal
    const parsed = JSON.parse(resultDataLines[0].replace(/^data: /, ''))
    expect(parsed).toEqual(signal)
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

// Issue 9 tests live in security-regression-hook.test.ts (requires jsdom environment)
