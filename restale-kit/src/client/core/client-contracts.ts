import type { InvalidateSignal } from '@/types/protocol.js'
import type { StandardSchemaV1 } from '@/types/standard-schema.js'

/**
 * Discriminated union representing the SSE client's connection state.
 */
export type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' }
  | { status: 'error'; error: Event }

/**
 * Configuration for the exponential backoff reconnect strategy.
 */
export interface ReconnectOptions {
  /** Base delay in milliseconds before the first retry. Default: 1_000. */
  baseDelayMs?: number
  /** Maximum delay cap in milliseconds. Default: 30_000. */
  maxDelayMs?: number
  /** Whether to apply random jitter to the delay. Default: true. */
  jitter?: boolean
  /** Maximum number of retry attempts before giving up. Default: Infinity. */
  maxRetries?: number
}

/**
 * Configuration options for `SSEInvalidatorClient`.
 */
export interface ClientOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  /** Whether to automatically reconnect on failure. Default: true. */
  autoReconnect?: boolean
  /** Reconnect backoff configuration. */
  reconnect?: ReconnectOptions
  /** Optional Standard Schema for runtime payload validation. */
  signalSchema?: StandardSchemaV1<unknown, TSignal>
  /**
   * Include credentials when opening the EventSource connection. Default: false.
   *
   * **Note:** Like `autoReconnect`, `reconnect`, and `signalSchema`, this option is applied
   * only when the client is initially created. In the React hook, changing this value on a
   * later render will not take effect until the `url` also changes (which recreates the client).
   */
  withCredentials?: boolean
}

/**
 * Typed event map for `SSEInvalidatorClient`.
 */
export interface SSEInvalidatorClientEventMap<TSignal extends InvalidateSignal> {
  invalidate: CustomEvent<TSignal | TSignal[]>
  statuschange: CustomEvent<ConnectionStatus>
  error: CustomEvent<Event>
}
