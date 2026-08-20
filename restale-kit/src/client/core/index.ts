// Client public API
export { SSEClient } from './sse-client.js'
export { makeInvalidationHandler } from './client-contracts.js'
export type {
  AutoReconnectOptions,
  ConnectionStatus,
  ClientOptions,
  ReconnectOptions,
  HttpStatusMatcher,
  RejectedConnectionResponse,
  SSEClientEventMap,
  InvalidationHandler,
} from './client-contracts.js'
export type { RevokeEventDetail, RenewEventDetail } from '../../types/protocol.js'

export type { Signal, SignalPayload, RevalidateSignal, InlineDataSignal, CacheKey } from '../../types/protocol.js'
