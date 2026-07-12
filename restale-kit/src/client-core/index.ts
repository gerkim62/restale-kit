// Client-core public API
export { SSEInvalidatorClient } from './client.js'
export type {
  ConnectionStatus,
  ClientOptions,
  ReconnectOptions,
  SSEInvalidatorClientEventMap,
} from './types.js'

// Re-export InvalidateSignal from core so adapter authors and direct
// client-core users don't need to also import from core
export type { InvalidateSignal } from '../core/types.js'
