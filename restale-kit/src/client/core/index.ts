// Client public API
export { SSEInvalidatorClient } from './sse-client.js'
export { makeAdaptedCallback } from './client-contracts.js'
export type {
  ConnectionStatus,
  ClientOptions,
  ReconnectOptions,
  HttpStatusMatcher,
  RejectedConnectionResponse,
  SSEInvalidatorClientEventMap,
  RevokeEventDetail,
  RenewEventDetail,
  AdaptedInvalidateCallback,
} from './client-contracts.js'

export type { InvalidateSignal } from '../../types/protocol.js'
