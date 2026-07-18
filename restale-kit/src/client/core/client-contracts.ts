import type { InvalidateSignal } from '@/types/protocol.js'
import type { StandardSchemaV1 } from '@/types/standard-schema.js'

/**
 * Discriminated union representing the SSE client's connection state.
 *
 * - `connecting` — actively establishing or waiting to retry.
 * - `open` — stream is live and delivering events.
 * - `closed` — stream has been shut down:
 *   - `reason: 'manual'` — caller called `client.close()`.
 *   - `reason: 'unmount'` — React hook unmounted the component.
 *   - `reason: 'revoked'` — server sent a terminal `revoke` frame (e.g. logout, ban).
 *     Auto-reconnect is suppressed until `connect()` is called explicitly.
 * - `error` — connection failed and retry limit was reached (or `autoReconnect` is off).
 */
export type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
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
 * Granular auto-reconnect settings for SSEInvalidatorClient.
 */
export interface AutoReconnectOptions {
  /** Enable native browser EventSource auto-reconnection on mid-stream network drops. Default: true. */
  native?: boolean
  /** Enable JavaScript exponential backoff retries on connection setup failure or closure. Default: true. */
  jsBackoff?: boolean
}

/**
 * Configuration options for `SSEInvalidatorClient`.
 */
export interface ClientOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  /**
   * Whether to automatically reconnect on failure. Default: true.
   *
   * Accepts a `boolean` or an `AutoReconnectOptions` object for granular control over
   * native browser EventSource mid-stream reconnects vs. JavaScript backoff retries.
   * Manual reconnection via `connect()` or `reconnect()` remains available regardless of setting.
   */
  autoReconnect?: boolean | AutoReconnectOptions
  /** Reconnect backoff configuration. */
  reconnect?: ReconnectOptions
  /** Optional Standard Schema for runtime payload validation. */
  signalSchema?: StandardSchemaV1<unknown, TSignal>
  /**
   * Include credentials when opening the EventSource connection. Default: false.
   *
   * **Note:** Like `autoReconnect`, `reconnect`, `signalSchema`, and `debug`, this option is applied
   * only when the client is initially created. In the React hook, changing this value on a
   * later render will not take effect until the `url` also changes (which recreates the client).
   */
  withCredentials?: boolean
  /**
   * Enable debug logging for connection lifecycle events. Default: false.
   *
   * **Note:** Like `autoReconnect`, `reconnect`, `signalSchema`, and `withCredentials`, this option is applied
   * only when the client is initially created. In the React hook, changing this value on a
   * later render will not take effect until the `url` also changes (which recreates the client).
   */
  debug?: boolean
}

/**
 * Typed event map for `SSEInvalidatorClient`.
 */
export interface SSEInvalidatorClientEventMap<TSignal extends InvalidateSignal> {
  invalidate: CustomEvent<TSignal | TSignal[]>
  statuschange: CustomEvent<ConnectionStatus>
  error: CustomEvent<Event>
  /** Emitted when the server sends a terminal `revoke` frame. Does not auto-reconnect. */
  revoke: CustomEvent<{ reason: string }>
}
