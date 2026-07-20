import type { InvalidateSignal, SignalTarget } from '@/types/protocol.js'
import type { StandardSchemaV1 } from '@/types/standard-schema.js'

/**
 * A phantom brand that marks an `onInvalidate` callback as having been produced
 * by a specific framework adapter (e.g. `useTanstackQueryAdapter`, `useSwrAdapter`).
 *
 * The type parameter `TTarget` records which signal target the callback handles.
 * `useReStale` reads this brand to infer the `target` option automatically and to
 * enforce that `target` and `onInvalidate` are consistent at compile time.
 *
 * You never construct this directly — adapter hooks return it for you.
 */
export type AdaptedInvalidateCallback<
  TTarget extends SignalTarget,
  TSignal extends InvalidateSignal = InvalidateSignal,
> = ((signal: TSignal | TSignal[]) => void) & {
  readonly __restaleTarget: TTarget
}

/**
 * Factory that brands a plain callback with its signal target.
 * Used internally by adapter hooks — not part of the public API.
 *
 * `Object.assign` merges the `__restaleTarget` property into the function object,
 * which TypeScript verifies structurally — no cast required.
 */
export function makeAdaptedCallback<
  TTarget extends SignalTarget,
  TSignal extends InvalidateSignal = InvalidateSignal,
>(
  target: TTarget,
  fn: (signal: TSignal | TSignal[]) => void
): AdaptedInvalidateCallback<TTarget, TSignal> {
  return Object.assign(fn, { __restaleTarget: target } as const)
}

/**
 * Discriminated union representing the SSE client's connection state.
 *
 * - `connecting` — actively establishing or waiting to retry.
 * - `open` — stream is live and delivering events.
 * - `closed` — stream has been shut down:
 *   - `reason: 'manual'` — caller called `client.close()`.
 *   - `reason: 'unmount'` — React hook unmounted the component.
 *   - `reason: 'revoked'` — server sent a terminal `revoke` frame (e.g. logout, ban),
 *     or a `renew`-triggered confirmatory reconnect exhausted its attempt budget.
 *     Auto-reconnect is suppressed until `connect()` is called explicitly.
 * - `error` — connection failed and retry limit was reached (or `autoReconnect` is off).
 */
export type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
  | { status: 'closed'; reason: 'rejected'; response: RejectedConnectionResponse }
  | { status: 'error'; error: Event }

/** HTTP response details exposed when an SSE handshake is intentionally not retried. */
export interface RejectedConnectionResponse {
  status: number
  headers: Readonly<Record<string, readonly string[]>>
}

/** Matches one HTTP status, a status class, or an inclusive status-code range. */
export type HttpStatusMatcher =
  | number
  | '1xx' | '2xx' | '3xx' | '4xx' | '5xx'
  | { from: number; to: number }

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
  /** Statuses that close immediately instead of being retried. Defaults to no matches. */
  nonRetryableStatuses?: HttpStatusMatcher | readonly HttpStatusMatcher[]
  /** Respect a retryable response's `Retry-After` header for its next retry. Default: `'ignore'`. */
  retryAfter?: 'respect' | 'ignore'
}

/**
 * Granular auto-reconnect settings for SSEInvalidatorClient.
 */
export interface AutoReconnectOptions {
  /** Enable managed reconnection after a mid-stream network drop. Default: true. */
  native?: boolean
  /** Enable managed exponential-backoff retries on connection setup failure or HTTP errors. Default: true. */
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
   * Manual reconnection via `connect()` remains available regardless of setting.
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
  /** Optional target discriminator expected by the client. */
  target?: SignalTarget
}

/**
 * Payload carried by the `revoke` CustomEvent.
 *
 * Discriminated on `reason` so consumers can narrow the type:
 *
 * ```ts
 * client.addEventListener('revoke', (e) => {
 *   if (e.detail.reason === 'unsupported-target') {
 *     console.warn(`Server supports: ${e.detail.supported.join(', ')}`)
 *   }
 * })
 * ```
 */
export type RevokeEventDetail =
  | {
      /** The connection was rejected because the requested target is not in the server's supported set. */
      reason: 'unsupported-target'
      /** The target value the client requested (from `__restale_target__`). */
      requested: string
      /** The target values the server channel is configured to support. */
      supported: string[]
    }
  | {
      /**
       * Any application-level revocation reason. Known values:
       * - `'deadline'`: A Frame Guard lifetime deadline fired and the confirmatory
       *   reconnect cycle exhausted all attempts. The client will not auto-reconnect.
       * - `'session-expired'`, `'logout'`, `'banned'` (or any custom string): integrator-
       *   supplied reason from a server-side `channel.revoke(reason)` call.
       * - `undefined`: the server sent a malformed or reason-less revoke frame.
       *
       * Explicitly excludes `'unsupported-target'` — that case always carries
       * `requested`/`supported` and is narrowed by the first branch.
       */
      reason: 'deadline' | (string & {}) | undefined
      requested?: never
      supported?: never
    }

/**
 * Typed event map for `SSEInvalidatorClient`.
 */
export interface SSEInvalidatorClientEventMap<TSignal extends InvalidateSignal> {
  invalidate: CustomEvent<TSignal | TSignal[]>
  statuschange: CustomEvent<ConnectionStatus>
  error: CustomEvent<Event>
  /** Emitted when a configured non-retryable HTTP status rejects the handshake. */
  rejected: CustomEvent<RejectedConnectionResponse>
  /**
   * Emitted when the server sends a terminal `revoke` frame. Does not auto-reconnect.
   *
   * The `detail` is a `RevokeEventDetail` discriminated union — narrow on `detail.reason`
   * to access the `requested`/`supported` fields for `'unsupported-target'`.
   */
  revoke: CustomEvent<RevokeEventDetail>
  /**
   * Emitted when the server sends a `renew` frame, indicating the connection is ending
   * intentionally (deadline reached) but the client is NOT being told it is unauthorized.
   *
   * The client will make up to `detail.maxAttempts` confirmatory reconnect attempts
   * automatically. This event fires once, at the moment the `renew` frame is received,
   * before any reconnect attempt begins. Listening to it is optional — reconnection
   * happens regardless.
   *
   * If all confirmatory attempts fail, a `statuschange` event is emitted with
   * `{ status: 'closed', reason: 'revoked' }` and a `revoke` event fires with
   * `{ reason: 'deadline' }`.
   */
  renew: CustomEvent<RenewEventDetail>
}

/**
 * Payload carried by the `renew` CustomEvent.
 */
export interface RenewEventDetail {
  /** Always `'deadline'` — the only reason a server currently sends `renew`. */
  reason: 'deadline'
  /** How many confirmatory reconnect attempts the client will make. */
  maxAttempts: number
  /** Base delay in milliseconds between attempts when `maxAttempts > 1`. */
  retryDelayMs: number
}
