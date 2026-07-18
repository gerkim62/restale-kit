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

