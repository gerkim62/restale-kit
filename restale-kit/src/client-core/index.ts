// Client-core public API
export { SSEInvalidatorClient } from './client.js'
export type {
  ConnectionStatus,
  ClientOptions,
  ReconnectOptions,
  SSEInvalidatorClientEventMap,
} from './types.js'

// Re-export InvalidateSignal from shared so adapter authors and direct
// client-core users don't need to also import from shared
export type { InvalidateSignal } from '../shared/types.js'
