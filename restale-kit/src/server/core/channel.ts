import type { InvalidateSignal, ChannelState, EventStore } from '@/types/protocol.js'
import { type StandardSchemaV1, validateStandardSchema } from '@/types/standard-schema.js'
import { ChannelClosedError } from '@/types/errors.js'
import { formatInvalidateFrame, formatKeepalive } from '@/server/core/framing.js'
import { createEventStore } from '@/server/core/event-store.js'
import { PROTOCOL_CONSTANTS } from '@/utils/constants.js'

/**
 * Configuration options for `createSSEChannel`.
 */
export interface SSEChannelOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  /** Keepalive comment interval in milliseconds. Default: 30_000 (30 seconds). */
  keepaliveIntervalMs?: number
  /** Optional Standard Schema for runtime signal validation. No schema = no validation. */
  signalSchema?: StandardSchemaV1<unknown, TSignal>
  /** Last event ID received from the client (e.g. from standard Last-Event-ID HTTP header). */
  lastEventId?: string
  /** Shared EventStore for recording history and replaying missed events upon reconnect. */
  eventStore?: EventStore<TSignal>
  /** Capacity of automatically instantiated EventStore if `eventStore` is not provided. */
  eventBufferCapacity?: number
  /** Custom ID generator for assigned event frames. Ignored if an external `eventStore` is provided. */
  idGenerator?: () => string
}

/**
 * A server-side SSE channel that produces a `ReadableStream<Uint8Array>`.
 *
 * Runtime-agnostic — does not know about Node's `http` module or any specific
 * framework. Transport helpers (`restale-kit/node`, `restale-kit/fetch`) pipe
 * this stream into their runtime's response mechanism.
 */
export interface SSEChannel<TSignal extends InvalidateSignal = InvalidateSignal> {
  /** Current lifecycle state of the channel. */
  readonly state: ChannelState
  /** The SSE byte stream to pipe into a response. */
  readonly stream: ReadableStream<Uint8Array>
  /**
   * Enqueue an invalidation signal (or batch) into the stream.
   *
   * - When `state` is `'closed'`: throws `ChannelClosedError`.
   * - When a `signalSchema` was provided and validation fails: throws `SchemaValidationError`.
   * - When a `signalSchema` returns a Promise: throws `SchemaValidationError` ("async schemas are not supported").
   *
   * Returns the event ID assigned to the invalidation frame.
   */
  invalidate(signal: TSignal | TSignal[], customId?: string): string
  /** Server-initiated close. Stops keepalive timer, closes the stream, transitions to `'closed'`. Idempotent. */
  close(): void
  /**
   * Called by a transport adapter when it detects the remote peer disconnected.
   * Same effect as `close()`. Idempotent.
   */
  disconnect(): void
  /**
   * Registers a one-shot callback invoked when the channel transitions to `'closed'`
   * (whether via `close()`, `disconnect()`, or stream cancellation).
   * If the channel is already closed the callback fires synchronously.
   */
  onClose(callback: () => void): void
}

/**
 * Creates a new SSE channel.
 *
 * The channel produces a standard `ReadableStream<Uint8Array>` containing
 * SSE-formatted events and periodic keepalive comments. Transport adapters
 * pipe this stream into a response.
 */
export function createSSEChannel<TSignal extends InvalidateSignal = InvalidateSignal>(
  options?: SSEChannelOptions<TSignal>
): SSEChannel<TSignal> {
  const keepaliveIntervalMs =
    options?.keepaliveIntervalMs ?? PROTOCOL_CONSTANTS.DEFAULT_KEEPALIVE_INTERVAL_MS
  const signalSchema = options?.signalSchema
  const lastEventId = options?.lastEventId
  const idGenerator = options?.idGenerator

  let eventStore: EventStore<TSignal> | undefined = options?.eventStore
  if (eventStore === undefined && options?.eventBufferCapacity !== undefined && options.eventBufferCapacity > 0) {
    eventStore = createEventStore<TSignal>({ capacity: options.eventBufferCapacity, idGenerator })
  }

  let state: ChannelState = 'open'
  let controller: ReadableStreamDefaultController<Uint8Array>
  let keepaliveTimer: ReturnType<typeof setInterval>
  const closeCallbacks: Array<() => void> = []

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl

      // Replay missed historical events if lastEventId and eventStore are present
      if (lastEventId !== undefined && eventStore !== undefined) {
        const missed = eventStore.getEventsAfter(lastEventId)
        for (const record of missed) {
          controller.enqueue(formatInvalidateFrame(record.signal, record.id))
        }
      }

      keepaliveTimer = setInterval(() => {
        if (state === 'open') {
          controller.enqueue(formatKeepalive())
        }
      }, keepaliveIntervalMs)
    },
    cancel() {
      // Stream consumer cancelled — treat as disconnect
      closeInternal()
    },
  })

  function closeInternal(): void {
    if (state === 'closed') return
    state = 'closed'
    clearInterval(keepaliveTimer)
    try {
      controller.close()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      // The stream controller closed status during cleanup
      console.warn(
        "[WARN][closeInternal] Controller close threw an expected error (likely already closed)",
        "\n  error:", error.stack || error.message
      )
    }
    // Fire one-shot close callbacks
    for (const cb of closeCallbacks) {
      try { cb() } catch { /* ignore errors in close callbacks */ }
    }
    closeCallbacks.length = 0
  }

  function invalidate(signal: TSignal | TSignal[], customId?: string): string {
    if (state === 'closed') {
      throw new ChannelClosedError()
    }

    if (signalSchema) {
      const signals = Array.isArray(signal) ? signal : [signal]
      for (const s of signals) {
        validateStandardSchema(s, signalSchema)
      }
    }

    let eventId = customId
    if (eventStore !== undefined) {
      const record = eventStore.add(signal, customId)
      eventId = record.id
      controller.enqueue(formatInvalidateFrame(signal, eventId))
    } else {
      controller.enqueue(formatInvalidateFrame(signal, undefined))
    }

    return eventId ?? ''
  }

  return {
    get state() {
      return state
    },
    stream,
    invalidate,
    close: closeInternal,
    disconnect: closeInternal,
    onClose(callback: () => void): void {
      if (state === 'closed') {
        callback()
      } else {
        closeCallbacks.push(callback)
      }
    },
  }
}
