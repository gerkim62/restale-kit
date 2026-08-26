// Client public API
export { SSEClient } from './sse-client'
export type {
  AutoReconnectOptions,
  ConnectionStatus,
  ClientOptions,
  ReconnectOptions,
  HttpStatusMatcher,
  RejectedConnectionResponse,
  SSEClientEventMap,
  InvalidationHandler,
} from './client-contracts'
export type { RevokeEventDetail, RenewEventDetail } from '../../types/protocol'

export type { Signal, SignalPayload, RevalidateSignal, InlineDataSignal, CacheKey } from '../../types/protocol'
