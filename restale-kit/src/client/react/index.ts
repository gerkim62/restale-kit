export { RestaleProvider } from './RestaleProvider.js'
export type { RestaleProviderProps, ConnectionSnapshot } from './RestaleProvider.js'
export { useRestale } from './useRestale.js'
export type { UseRestaleOptions, UseRestaleResult } from './useRestale.js'

// Re-export client contract types for convenience
export type {
  ConnectionStatus,
  RevokeEventDetail,
  RenewEventDetail,
  RejectedConnectionResponse,
  AdaptedCallback,
} from '../core/client-contracts.js'
