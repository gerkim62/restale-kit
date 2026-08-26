export { RestaleProvider } from './RestaleProvider'
export type { RestaleProviderProps, ConnectionSnapshot } from './RestaleProvider'
export { useRestale } from './useRestale'
export type { UseRestaleOptions, UseRestaleResult } from './useRestale'

// Re-export client contract types for convenience
export type {
  ConnectionStatus,
  RevokeEventDetail,
  RenewEventDetail,
  RejectedConnectionResponse,
  InvalidationHandler,
} from '../core/client-contracts'
