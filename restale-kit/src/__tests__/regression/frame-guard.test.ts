import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSEChannel } from '@/server/core/channel.js'
import { createEventStore } from '@/server/core/event-store.js'
import { ChannelClosedError } from '@/types/errors.js'
import type { FrameGuardCtx, UniversalSignal } from '@/types/protocol.js'

describe('Frame guard (beforeFrame) regression tests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('receives real signals with frameType "signal" and deep-equal signal payloads', () => {
    const captured: FrameGuardCtx[] = []
    const channel = createSSEChannel({
      beforeFrame: (ctx) => {
        captured.push(ctx)
        return { action: 'send' }
      },
    })

    const signal: UniversalSignal = {
      key: ['todos', 'detail', 42],
      inlineData: { title: 'Clean room', completed: false },
      markStale: true,
    }

    channel.invalidate(signal)

    expect(captured).toHaveLength(1)
    const ctx = captured[0]
    expect(ctx.frameType).toBe('signal')
    expect(ctx.connectionId).toBe(channel.connectionId)
    expect(ctx.isResume).toBe(false)
    if (ctx.frameType === 'signal') {
      expect(ctx.signal).toEqual(signal)
    }

    channel.close()
  })

  it('triggers keepalive tick with guardKeepalive: true, frameType "keepalive", and signal undefined', () => {
    const captured: FrameGuardCtx[] = []
    const channel = createSSEChannel({
      keepaliveIntervalMs: 500,
      guardKeepalive: true,
      beforeFrame: (ctx) => {
        captured.push(ctx)
        return { action: 'send' }
      },
    })

    expect(captured).toHaveLength(0)

    vi.advanceTimersByTime(500)

    expect(captured).toHaveLength(1)
    const ctx = captured[0]
    expect(ctx.frameType).toBe('keepalive')
    expect(ctx.signal).toBeUndefined()
    expect(ctx.connectionId).toBe(channel.connectionId)

    channel.close()
  })

  it('action "skip" prevents recording the event in the attached eventStore', () => {
    const eventStore = createEventStore({ capacity: 10 })
    eventStore.add({ key: ['init'] }, 'init-id')

    const channel = createSSEChannel({
      eventStore,
      beforeFrame: (ctx) => {
        if (ctx.frameType === 'signal') {
          return { action: 'skip' }
        }
        return { action: 'send' }
      },
    })

    const resultId = channel.invalidate({ key: ['posts', 'drafts'] })
    expect(resultId).toBe('')

    // Check that eventStore only has the initial event and not the skipped one
    const history = eventStore.getEventsAfter('init-id')
    expect(history.stale).toBe(false)
    expect(history.events).toHaveLength(0)

    channel.close()
  })

  it('action "close" sets channel.state to "closed" and enqueues a revoke frame', async () => {
    const channel = createSSEChannel({
      beforeFrame: () => ({ action: 'close', reason: 'unauthorized-access' }),
    })

    const reader = channel.stream.getReader()

    expect(() => {
      channel.invalidate({ key: ['admin', 'secrets'] })
    }).toThrow(ChannelClosedError)

    expect(channel.state).toBe('closed')

    const decoder = new TextDecoder()
    // First chunk is connected frame
    const chunk1 = await reader.read()
    expect(decoder.decode(chunk1.value)).toContain('event: connected')

    // Second chunk is revoke frame
    const chunk2 = await reader.read()
    expect(chunk2.done).toBe(false)
    expect(chunk2.value).toBeDefined()

    const frameText = decoder.decode(chunk2.value)
    expect(frameText).toContain('event: revoke')
    expect(frameText).toContain('"reason":"unauthorized-access"')
  })
})
