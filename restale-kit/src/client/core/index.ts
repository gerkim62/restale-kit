// Client public API
export { SSEInvalidatorClient } from './sse-client.js'
export { makeAdaptedCallback } from './client-contracts.js'
export type {
  AutoReconnectOptions,
  ConnectionStatus,
  ClientOptions,
  ReconnectOptions,
  HttpStatusMatcher,
  RejectedConnectionResponse,
  SSEInvalidatorClientEventMap,
  AdaptedInvalidateCallback,
} from './client-contracts.js'
export type { RevokeEventDetail, RenewEventDetail } from '../../types/protocol.js'

export type { InvalidateSignal } from '../../types/protocol.js'
