import type { InvalidateSignal, ChannelState } from './types.js'
import { type StandardSchemaV1, validateStandardSchema } from './standard-schema.js'
import { ChannelClosedError } from './errors.js'
import { formatInvalidateFrame, formatKeepalive } from './framing.js'

const DEFAULT_KEEPALIVE_INTERVAL_MS = 30_000

/**
 * Configuration options for `createSSEChannel`.
 */
export interface SSEChannelOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  /** Keepalive comment interval in milliseconds. Default: 30_000 (30 seconds). */
  keepaliveIntervalMs?: number
  /** Optional Standard Schema for runtime signal validation. No schema = no validation. */
  signalSchema?: StandardSchemaV1<unknown, TSignal>
}

/**
 * A server-side SSE channel that produces a `ReadableStream<Uint8Array>`.
 *
 * Runtime-agnostic — does not know about Node's `http` module or any specific
 * framework. Transport adapters (`restale-kit/node`, `restale-kit/fetch`) pipe
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
   */
  invalidate(signal: TSignal | TSignal[]): void
  /** Server-initiated close. Stops keepalive timer, closes the stream, transitions to `'closed'`. Idempotent. */
  close(): void
  /**
   * Called by a transport adapter when it detects the remote peer disconnected.
   * Same effect as `close()`. Idempotent.
   */
  disconnect(): void
}

/**
 * Validates a single signal against a Standard Schema. Throws on failure or async result.
 */
function validateSignal<TSignal extends InvalidateSignal>(
  signal: unknown,
  schema: StandardSchemaV1<unknown, TSignal>
): TSignal {
  return validateStandardSchema(signal, schema)
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
  const keepaliveIntervalMs = options?.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS
  const signalSchema = options?.signalSchema

  let state: ChannelState = 'open'
  let controller: ReadableStreamDefaultController<Uint8Array>
  let keepaliveTimer: ReturnType<typeof setInterval>

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl
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
    } catch {
      // Controller may already be closed if stream was cancelled
    }
  }

  function invalidate(signal: TSignal | TSignal[]): void {
    if (state === 'closed') {
      throw new ChannelClosedError()
    }

    if (signalSchema) {
      const signals = Array.isArray(signal) ? signal : [signal]
      for (const s of signals) {
        validateSignal(s, signalSchema)
      }
    }

    controller.enqueue(formatInvalidateFrame(signal))
  }

  return {
    get state() {
      return state
    },
    stream,
    invalidate,
    close: closeInternal,
    disconnect: closeInternal,
  }
}
