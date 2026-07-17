import { describe, it, expect } from 'vitest'
import { createEventStore } from './event-store.js'

describe('event-store', () => {
  it('generates auto-incrementing integer string IDs by default', () => {
    const store = createEventStore()
    const r1 = store.add({ key: ['a'] })
    const r2 = store.add({ key: ['b'] })

    expect(r1.id).toBe('1')
    expect(r2.id).toBe('2')
  })

  it('uses custom ID generator if supplied', () => {
    let count = 100
    const store = createEventStore({ idGenerator: () => `evt-${String(++count)}` })
    const r1 = store.add({ key: ['a'] })

    expect(r1.id).toBe('evt-101')
  })

  it('respects explicitly provided custom ID on add', () => {
    const store = createEventStore()
    const record = store.add({ key: ['a'] }, 'explicit-id-999')

    expect(record.id).toBe('explicit-id-999')
  })

  it('evicts oldest events when capacity limit is reached', () => {
    const store = createEventStore({ capacity: 3 })
    store.add({ key: ['1'] })
    store.add({ key: ['2'] })
    store.add({ key: ['3'] })
    const r4 = store.add({ key: ['4'] }) // Evicts '1'

    // '0' was never added — stale: true, events: []
    const miss = store.getEventsAfter('0')
    expect(miss.stale).toBe(true)
    expect(miss.events).toEqual([])

    // Use a known ID that is still in the buffer to verify catchup
    const { events: after2, stale: stale2 } = store.getEventsAfter('2')
    expect(stale2).toBe(false)
    expect(after2.map((e) => e.id)).toEqual(['3', '4'])

    // Using the last known ID returns nothing after it (not stale — cursor is valid)
    const { events: afterLast, stale: staleLast } = store.getEventsAfter(r4.id)
    expect(staleLast).toBe(false)
    expect(afterLast).toEqual([])
  })

  it('getEventsAfter returns events strictly following lastEventId', () => {
    const store = createEventStore()
    store.add({ key: ['1'] }) // id '1'
    store.add({ key: ['2'] }) // id '2'
    store.add({ key: ['3'] }) // id '3'

    const { events: afterOne, stale: staleOne } = store.getEventsAfter('1')
    expect(staleOne).toBe(false)
    expect(afterOne.map((e) => e.id)).toEqual(['2', '3'])

    const { events: afterThree, stale: staleThree } = store.getEventsAfter('3')
    expect(staleThree).toBe(false)
    expect(afterThree).toEqual([])
  })

  it('getEventsAfter returns stale: true if lastEventId is missing or evicted', () => {
    const store = createEventStore({ capacity: 2 })
    store.add({ key: ['1'] })
    store.add({ key: ['2'] })
    store.add({ key: ['3'] }) // '1' is evicted

    // '1' was evicted — stale: true so the caller can trigger a full refetch
    const evicted = store.getEventsAfter('1')
    expect(evicted.stale).toBe(true)
    expect(evicted.events).toEqual([])

    // Unknown ID — also stale
    const unknown = store.getEventsAfter('nonexistent')
    expect(unknown.stale).toBe(true)
    expect(unknown.events).toEqual([])

    // Known ID still in buffer — stale: false, correct events returned
    const { events, stale } = store.getEventsAfter('2')
    expect(stale).toBe(false)
    expect(events.map((e) => e.id)).toEqual(['3'])
  })

  it('clear removes all events from store', () => {
    const store = createEventStore()
    store.add({ key: ['a'] })
    store.clear()

    const { events, stale } = store.getEventsAfter('1')
    expect(stale).toBe(true)
    expect(events).toEqual([])
  })
})
