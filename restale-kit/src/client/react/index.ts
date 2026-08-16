export { useReStale } from './useReStale.js'
export type { UseReStaleOptions, UseReStaleResult } from './useReStale.js'

// Re-export client contract types for convenience
export type {
  ConnectionStatus,
  RevokeEventDetail,
  RenewEventDetail,
  RejectedConnectionResponse,
  AdaptedCallback,
} from '../core/client-contracts.js'
