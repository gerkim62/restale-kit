import type { InvalidateSignal, EventRecord, EventStore, EventStoreResult } from '@/types/protocol.js'

/**
 * Options for configuring an in-memory `EventStore`.
 */
export interface EventStoreOptions {
  /** Maximum number of historical events to keep in the ring buffer. Default: 100. */
  capacity?: number
  /** Custom generator function for event IDs. If omitted, uses auto-incrementing integer strings. */
  idGenerator?: () => string
}

const DEFAULT_CAPACITY = 100

/**
 * Creates an in-memory bounded ring-buffer store for historical invalidation events.
 */
export function createEventStore<TSignal extends InvalidateSignal = InvalidateSignal>(
  options?: EventStoreOptions
): EventStore<TSignal> {
  const capacity = options?.capacity ?? DEFAULT_CAPACITY
  const customIdGenerator = options?.idGenerator

  const records: EventRecord<TSignal>[] = []
  let nextSequence = 1

  function generateId(): string {
    if (customIdGenerator) {
      return customIdGenerator()
    }
    const current = nextSequence
    nextSequence += 1
    return String(current)
  }

  function add(signal: TSignal | TSignal[], customId?: string): EventRecord<TSignal> {
    const id = customId ?? generateId()
    const record: EventRecord<TSignal> = { id, signal }

    records.push(record)

    if (records.length > capacity) {
      records.shift()
    }

    return record
  }

  function getEventsAfter(lastEventId: string): EventStoreResult<TSignal> {
    const index = records.findIndex((rec) => rec.id === lastEventId)
    if (index === -1) {
      // lastEventId not found — it either never existed or fell off the ring buffer.
      // Return stale: true so callers can distinguish "cursor missed" from "nothing new".
      // The channel uses this to send a full-invalidate signal, prompting the client to refetch.
      return { events: [], stale: true }
    }
    return { events: records.slice(index + 1), stale: false }
  }

  function clear(): void {
    records.length = 0
  }

  return {
    add,
    getEventsAfter,
    clear,
  }
}
