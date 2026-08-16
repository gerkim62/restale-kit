import type { EventRecord, EventStore, EventStoreResult, UniversalSignal } from '@/types/protocol.js'
export interface EventStoreOptions {
  capacity?: number
  idGenerator?: () => string
}

/** Creates an in-memory, bounded event store for Last-Event-ID replay. */
export function createEventStore(options?: EventStoreOptions): EventStore {
  const capacity = options?.capacity ?? 100
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new RangeError('[createEventStore] capacity must be a positive safe integer.')
  }
  const idGenerator = options?.idGenerator
  const events: EventRecord[] = []
  let nextSequence = 1

  function add(signal: UniversalSignal | UniversalSignal[], customId?: string): EventRecord {
    const record = { id: customId ?? idGenerator?.() ?? String(nextSequence++), signal }
    events.push(record)
    if (events.length > capacity) events.splice(0, events.length - capacity)
    return record
  }

  function getEventsAfter(lastEventId: string): EventStoreResult {
    const index = events.findIndex((event) => event.id === lastEventId)
    if (index < 0) return { events: [], stale: true }
    return { events: events.slice(index + 1), stale: false }
  }

  return { add, getEventsAfter, clear: () => { events.length = 0 } }
}
