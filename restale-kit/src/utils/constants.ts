/**
 * Central protocol string constants, header names, and default configuration values.
 */
export const PROTOCOL_CONSTANTS = {
  RESTALE_REQUEST_ID_PARAM: '__restale_cid__',
  RESTALE_TARGET_PARAM: '__restale_target__',
  LAST_EVENT_ID_HEADER: 'last-event-id',
  TARGET_HEADER: 'x-restale-target',
  DEFAULT_CONTROL_TOPIC: '__restale_control__',
  DEFAULT_KEEPALIVE_INTERVAL_MS: 0,
  DEFAULT_AUTO_RECONNECT: true,
  DEFAULT_MAX_RETRIES: Infinity,
} as const

/**
 * Standard HTTP headers required for Server-Sent Events (SSE) responses.
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const

/**
 * Additional response headers used by restale-kit transport adapters.
 */
export const SSE_RESPONSE_HEADERS = {
  RESTALE_TARGET: 'X-ReStale-Target',
  RESTALE_SUPPORTED: 'X-ReStale-Supported',
} as const

/**
 * Event names used across PubSub adapters.
 */
export const PUBSUB_EVENTS = {
  INVALIDATE: 'invalidate',
  CONTROL: 'control',
} as const

/**
 * Event names emitted over SSE streams.
 */
export const SSE_EVENTS = {
  INVALIDATE: 'invalidate',
  REVOKE: 'revoke',
  KEEPALIVE: 'keepalive',
  /** Sent by the server before closing to request a single confirmatory reconnect (§4.1.2). */
  RENEW: 'renew',
} as const

/**
 * Server-side defaults for Frame Guard lifetime and renew-frame construction.
 * These are implementation constants, not user-facing configuration.
 */
export const FRAME_GUARD_DEFAULTS = {
  /** Default `maxAttempts` placed in the `renew` frame when `onDeadline: 'reconnect'`. */
  RENEW_MAX_ATTEMPTS: 1,
  /** Default `retryDelayMs` placed in the `renew` frame when `onDeadline: 'reconnect'`. */
  RENEW_RETRY_DELAY_MS: 250,
  /**
   * Minimum elapsed time (ms) before a deadline may fire after channel creation.
   * Prevents a channel whose deadline source is already stale from immediately
   * cycling through renew → reconnect in a tight loop (spec §4.1.6).
   * Re-uses the default retryDelayMs value — same answer to the same question.
   */
  DEADLINE_MIN_FIRE_DELAY_MS: 250,
  /**
   * Server-side jitter window applied when scheduling a deadline timer.
   * The actual fire time is nudged by a random value in [0, DEADLINE_JITTER_WINDOW_MS)
   * so connections sharing the same TTL don't all send `renew` simultaneously (spec §4.1.4).
   */
  DEADLINE_JITTER_WINDOW_MS: 500,
  /**
   * Client-side jitter fraction applied on top of each `retryDelayMs` interval when
   * `maxAttempts > 1`. Each wait is multiplied by a factor uniformly distributed in
   * [1 - RENEW_JITTER_FACTOR, 1 + RENEW_JITTER_FACTOR] (spec §4.1.5).
   */
  RENEW_JITTER_FACTOR: 0.2,
} as const

/**
 * Standard signal target discriminators.
 */
export const SIGNAL_TARGETS = {
  TANSTACK: 'tanstack-query',
  SWR: 'swr',
  RTK: 'rtk-query',
  GENERIC: 'generic',
} as const

