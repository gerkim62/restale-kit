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
    store.add({ key: ['4'] }) // Evicts '1'

    const events = store.getEventsAfter('0')
    expect(events.map((e) => e.id)).toEqual(['2', '3', '4'])
  })

  it('getEventsAfter returns events strictly following lastEventId', () => {
    const store = createEventStore()
    store.add({ key: ['1'] }) // id '1'
    store.add({ key: ['2'] }) // id '2'
    store.add({ key: ['3'] }) // id '3'

    const afterOne = store.getEventsAfter('1')
    expect(afterOne.map((e) => e.id)).toEqual(['2', '3'])

    const afterThree = store.getEventsAfter('3')
    expect(afterThree).toEqual([])
  })

  it('getEventsAfter returns all stored records if lastEventId is missing or evicted', () => {
    const store = createEventStore({ capacity: 2 })
    store.add({ key: ['1'] })
    store.add({ key: ['2'] })
    store.add({ key: ['3'] }) // '1' is evicted

    // '1' was evicted, so it returns all currently retained records (2 and 3)
    expect(store.getEventsAfter('1').map((e) => e.id)).toEqual(['2', '3'])
    // Unknown ID
    expect(store.getEventsAfter('nonexistent').map((e) => e.id)).toEqual(['2', '3'])
  })

  it('clear removes all events from store', () => {
    const store = createEventStore()
    store.add({ key: ['a'] })
    store.clear()

    expect(store.getEventsAfter('1')).toEqual([])
  })
})
