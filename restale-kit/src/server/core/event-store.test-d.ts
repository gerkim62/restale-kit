import { describe, expectTypeOf, test } from 'vitest'
import { createEventStore, type EventStore, type EventRecord, type EventStoreResult } from '@/server/core/index.js'
import type { InvalidateSignal, SWRSignal, TanStackQuerySignal } from '@/types/index.js'

describe('createEventStore type assertions', () => {
  test('createEventStore returns EventStore typed with TSignal', () => {
    const store = createEventStore<SWRSignal>({ capacity: 50 })
    expectTypeOf(store).toEqualTypeOf<EventStore<SWRSignal>>()

    const record = store.add({ target: 'swr', key: ['todos'] })
    expectTypeOf(record).toEqualTypeOf<EventRecord<SWRSignal>>()
    expectTypeOf(record.id).toEqualTypeOf<string>()
    expectTypeOf(record.signal).toEqualTypeOf<SWRSignal | SWRSignal[]>()

    const result = store.getEventsAfter('10')
    expectTypeOf(result).toEqualTypeOf<EventStoreResult<SWRSignal>>()
    expectTypeOf(result.stale).toEqualTypeOf<boolean>()
    expectTypeOf(result.events).toEqualTypeOf<EventRecord<SWRSignal>[]>()
  })

  test('createEventStore add rejects mismatched signal target', () => {
    const store = createEventStore<SWRSignal>({ capacity: 50 })

    // @ts-expect-error TanStackQuerySignal should be rejected on EventStore<SWRSignal>
    store.add({ target: 'tanstack-query', queryKey: ['todos'] })
  })

  test('createEventStore default generic is InvalidateSignal', () => {
    const store = createEventStore()
    expectTypeOf(store).toEqualTypeOf<EventStore<InvalidateSignal>>()
  })
})

