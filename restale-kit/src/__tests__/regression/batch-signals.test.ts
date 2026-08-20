import { describe, it, expect } from 'vitest'
import { validatePayload } from '@/client/core/validation.js'
import { validateSignalPayload, createSSEChannel } from '@/server/core/channel.js'
import { createEventStore } from '@/server/core/event-store.js'
import type { Signal } from '@/types/protocol.js'

describe('Batch signal semantics', () => {
  describe('All-or-nothing validation atomicity', () => {
    const validSignal1: Signal = { key: ['todos'], exact: true }
    const validSignal2: Signal = { key: ['users', 1], inlineData: { name: 'Alice' }, markStale: true }
    const invalidSignalMissingKey = { exact: true }
    const invalidSignalInvalidInlineData = { key: ['users'], inlineData: undefined }
    const invalidSignalMixedArms = { key: ['users'], inlineData: { id: 1 }, exact: true }
    const invalidSignalMarkStaleWithoutInline = { key: ['posts'], markStale: true }

    it('validatePayload (client) rejects the entire batch if any single element is invalid', () => {
      // [valid, invalid]
      expect(() => validatePayload([validSignal1, invalidSignalMissingKey])).toThrow()
      expect(() => validatePayload([validSignal1, invalidSignalInvalidInlineData])).toThrow()
      expect(() => validatePayload([validSignal1, invalidSignalMixedArms])).toThrow()
      expect(() => validatePayload([validSignal1, invalidSignalMarkStaleWithoutInline])).toThrow()

      // [invalid, valid]
      expect(() => validatePayload([invalidSignalMissingKey, validSignal1])).toThrow()
      expect(() => validatePayload([invalidSignalInvalidInlineData, validSignal2])).toThrow()

      // [valid, valid, invalid, valid]
      expect(() =>
        validatePayload([validSignal1, validSignal2, invalidSignalMixedArms, validSignal1])
      ).toThrow()
    })

    it('validateSignalPayload (server) rejects the entire batch if any single element is invalid', () => {
      // [valid, invalid]
      expect(() => { validateSignalPayload([validSignal1, invalidSignalMissingKey]) }).toThrow()
      expect(() => { validateSignalPayload([validSignal1, invalidSignalInvalidInlineData]) }).toThrow()
      expect(() => { validateSignalPayload([validSignal1, invalidSignalMixedArms]) }).toThrow()
      expect(() => { validateSignalPayload([validSignal1, invalidSignalMarkStaleWithoutInline]) }).toThrow()

      // [invalid, valid]
      expect(() => { validateSignalPayload([invalidSignalMissingKey, validSignal1]) }).toThrow()
      expect(() => { validateSignalPayload([invalidSignalInvalidInlineData, validSignal2]) }).toThrow()

      // [valid, valid, invalid, valid]
      expect(() => {
        validateSignalPayload([validSignal1, validSignal2, invalidSignalMixedArms, validSignal1])
      }).toThrow()
    })
  })

  describe('Single-frame wire serialization and EventStore recording', () => {
    it('serializes a batch as a single SSE frame and stores it as a single EventRecord', async () => {
      const eventStore = createEventStore({ capacity: 10 })
      const channel = createSSEChannel({
        eventStore,
        keepaliveIntervalMs: 0, // disable keepalive for deterministic read
      })

      const reader = channel.stream.getReader()

      const sig1: Signal = { key: ['posts', 1], exact: true }
      const sig2: Signal = { key: ['comments'], inlineData: [{ id: 101, text: 'hi' }] }
      const batch: Signal[] = [sig1, sig2]

      // Add a baseline event so we can test replay/getEventsAfter
      eventStore.add({ key: ['baseline'] }, 'evt-0')

      const eventId = channel.invalidate(batch, 'evt-batch-42')
      expect(eventId).toBe('evt-batch-42')

      const decoder = new TextDecoder()
      // Initial chunk is connected frame
      const chunk1 = await reader.read()
      expect(decoder.decode(chunk1.value)).toContain('event: connected')

      // Second chunk is batch invalidate frame
      const chunk = await reader.read()
      expect(chunk.done).toBe(false)
      expect(chunk.value).toBeDefined()

      const frameText = decoder.decode(chunk.value)

      // Must have exactly one "event: invalidate" and one "id: evt-batch-42"
      const eventMatches = frameText.match(/event: invalidate/g)
      expect(eventMatches).toHaveLength(1)

      const idMatches = frameText.match(/id: evt-batch-42/g)
      expect(idMatches).toHaveLength(1)

      // Payload must parse back to the array of two signals
      const dataLine = frameText
        .split('\n')
        .find((l) => l.startsWith('data: '))
      expect(dataLine).toBeDefined()
      const parsedData = JSON.parse(dataLine!.slice(6))
      expect(parsedData).toEqual(batch)

      // EventStore must contain exactly ONE record for the batch whose .signal is the array
      const history = eventStore.getEventsAfter('evt-0')
      expect(history.stale).toBe(false)
      expect(history.events).toHaveLength(1)
      expect(history.events[0]).toEqual({
        id: 'evt-batch-42',
        signal: batch,
      })

      channel.close()
    })
  })
})
