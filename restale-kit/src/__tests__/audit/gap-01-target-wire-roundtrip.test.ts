/**
 * Gap 1: target-specific wire frames must be client-round-trippable.
 *
 * Target-specific signals have different shapes. Their `target` discriminator
 * is therefore required both for client-side validation and adapter routing.
 */
import { describe, expect, it } from 'vitest'
import { validatePayload } from '../../client/core/validation.js'
import { createSSEChannel } from '../../server/core/channel.js'
import { formatInvalidateFrame } from '../../server/core/framing.js'
import type { ExplicitSignalForTarget, ReStaleSignal, RTKQuerySignal, SWRSignal, TanStackQuerySignal } from '../../types/protocol.js'

type TargetedSignal = ExplicitSignalForTarget<'tanstack-query'> | ExplicitSignalForTarget<'swr'> | ExplicitSignalForTarget<'rtk-query'>

function parseInvalidateFrame(frame: Uint8Array): unknown {
  const text = new TextDecoder().decode(frame)
  expect(text).toMatch(/^event: invalidate\n/)
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .join('\n')
  return JSON.parse(data)
}

function wirePayload(signal: ReStaleSignal | ReStaleSignal[]): unknown {
  return parseInvalidateFrame(formatInvalidateFrame(signal))
}

async function nextChannelPayload(stream: ReadableStream<Uint8Array>): Promise<unknown> {
  const reader = stream.getReader()
  const { value, done } = await reader.read()
  expect(done).toBe(false)
  expect(value).toBeDefined()
  await reader.cancel()
  return parseInvalidateFrame(value!)
}

describe('Gap 1: target-specific wire frames client round-trip', () => {
  describe('TanStack Query signals', () => {
    it('preserves enough information to validate queryKey invalidation', () => {
      const signal: TanStackQuerySignal = { target: 'tanstack-query', queryKey: ['todos', 'list'] }

      expect(wirePayload(signal)).toEqual(signal)
      expect(validatePayload(wirePayload(signal))).toEqual(signal)
    })

    it.each<TanStackQuerySignal>([
      { target: 'tanstack-query', queryKey: ['users'] },
      { target: 'tanstack-query', queryKey: ['posts', 1], action: 'invalidate' },
      { target: 'tanstack-query', queryKey: ['todos'], action: 'refetch' },
      { target: 'tanstack-query', queryKey: ['profile'], action: 'reset' },
    ])('round-trips each supported TanStack action (%o)', (signal) => {
      expect(validatePayload(wirePayload(signal))).toEqual(signal)
    })

    it('preserves TanStack filter options', () => {
      const signal: TanStackQuerySignal = {
        target: 'tanstack-query',
        queryKey: ['todos'],
        exact: true,
        type: 'inactive',
        stale: true,
      }

      expect(validatePayload(wirePayload(signal))).toEqual(signal)
    })
  })

  describe('RTK Query signals', () => {
    it('preserves tag-based invalidation through framing', () => {
      const signal: RTKQuerySignal = {
        target: 'rtk-query',
        tags: [{ type: 'Todo' }, { type: 'User', id: 1 }],
      }

      expect(wirePayload(signal)).toEqual(signal)
      expect(validatePayload(wirePayload(signal))).toEqual(signal)
    })

    it('round-trips batches of RTK tags', () => {
      const signal: RTKQuerySignal = {
        target: 'rtk-query',
        tags: [{ type: 'Post' }, { type: 'Comment', id: 42 }, { type: 'User', id: 'abc' }],
      }

      expect(validatePayload(wirePayload(signal))).toEqual(signal)
    })

    it.each<RTKQuerySignal>([
      { target: 'rtk-query', tags: [{ type: 'Item' }] },
      { target: 'rtk-query', tags: [{ type: 'Item', id: 1 }] },
      { target: 'rtk-query', tags: [{ type: 'Item', id: 'uuid' }] },
    ])('preserves RTK tag ID variations (%o)', (signal) => {
      expect(validatePayload(wirePayload(signal))).toEqual(signal)
    })
  })

  describe('SWR signals', () => {
    it('preserves key-based invalidation through framing', () => {
      const signal: SWRSignal = { target: 'swr', key: ['/api/todos'] }

      expect(wirePayload(signal)).toEqual(signal)
      expect(validatePayload(wirePayload(signal))).toEqual(signal)
    })

    it.each<SWRSignal>([
      { target: 'swr', key: ['/api/users'], action: 'revalidate' },
      { target: 'swr', key: ['/api/users'], action: 'purge' },
      { target: 'swr', key: ['/api/users'], action: 'remove' },
    ])('round-trips each supported SWR action (%o)', (signal) => {
      expect(validatePayload(wirePayload(signal))).toEqual(signal)
    })

    it('preserves structured SWR keys', () => {
      const signal: SWRSignal = {
        target: 'swr',
        key: ['/api/todos', { page: 1, filters: ['open'] }],
        action: 'purge',
      }

      expect(validatePayload(wirePayload(signal))).toEqual(signal)
    })

    it('preserves SWR revalidation and match options', () => {
      const signal: SWRSignal = {
        target: 'swr',
        key: ['/api/posts'],
        action: 'revalidate',
        revalidate: true,
        match: 'prefix',
      }

      expect(validatePayload(wirePayload(signal))).toEqual(signal)
    })
  })

  describe('Multi-target scenarios', () => {
    const signals: TargetedSignal[] = [
      { target: 'tanstack-query', queryKey: ['todos'] },
      { target: 'swr', key: ['/api/todos'] },
      { target: 'rtk-query', tags: [{ type: 'Todo' }] },
    ]

    it('preserves target information for every signal in a mixed batch', () => {
      expect(wirePayload(signals)).toEqual(signals)
      expect(validatePayload(wirePayload(signals))).toEqual(signals)
    })

    it('filters a multi-target channel by the client-requested target without losing the discriminator', async () => {
      const channel = createSSEChannel({
        target: ['tanstack-query', 'swr', 'rtk-query'] as const,
        requestedTarget: 'swr',
      })

      channel.invalidate(signals)

      expect(await nextChannelPayload(channel.stream)).toEqual([signals[1]])
    })
  })

  describe('End-to-end channel frames', () => {
    it.each<TargetedSignal>([
      { target: 'tanstack-query', queryKey: ['test'] },
      { target: 'rtk-query', tags: [{ type: 'Todo', id: 1 }] },
      { target: 'swr', key: ['/api/test'], action: 'purge' },
    ])('emits a client-valid %s frame from a channel', async (signal) => {
      const channel = createSSEChannel({ target: signal.target })
      channel.invalidate(signal)

      const payload = await nextChannelPayload(channel.stream)
      expect(payload).toEqual(signal)
      expect(validatePayload(payload)).toEqual(signal)
    })
  })
})
