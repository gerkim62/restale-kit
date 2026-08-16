import type { RevokeEventDetail, RenewEventDetail, UniversalSignal } from '@/types/protocol.js'

export type { RevokeEventDetail, RenewEventDetail } from '@/types/protocol.js'

/** A callback produced by an adapter factory. */
export type AdaptedCallback = ((signal: UniversalSignal | UniversalSignal[]) => void) & {
  readonly __restaleAdapter: true
}
/** Brands a callback without attaching target-specific metadata. */
export function makeAdaptedCallback(
  fn: (signal: UniversalSignal | UniversalSignal[]) => void,
): AdaptedCallback {
  if (typeof fn !== 'function') {
    throw new TypeError('Expected an adapter callback function')
  }

  return Object.assign(fn, { __restaleAdapter: true as const })
}

export type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
  | { status: 'closed'; reason: 'rejected'; response: RejectedConnectionResponse }
  | { status: 'error'; error: Event }

export interface RejectedConnectionResponse {
  status: number
  headers: Readonly<Record<string, readonly string[]>>
}

export type HttpStatusMatcher =
  | number
  | '1xx' | '2xx' | '3xx' | '4xx' | '5xx'
  | { from: number; to: number }

export interface ReconnectOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  jitter?: boolean
  maxRetries?: number
  nonRetryableStatuses?: HttpStatusMatcher | readonly HttpStatusMatcher[]
  retryAfter?: 'respect' | 'ignore'
}

export interface AutoReconnectOptions {
  native?: boolean
  jsBackoff?: boolean
}

export interface ClientOptions {
  autoReconnect?: boolean | AutoReconnectOptions
  reconnect?: ReconnectOptions
  withCredentials?: boolean
  debug?: boolean
  skipSelf?: boolean
  clientContextUrl?: string
  callback?: AdaptedCallback | ((signal: UniversalSignal | UniversalSignal[]) => void)
  onConnect?: (event: Event) => void
  onDisconnect?: (event: Event) => void
  onError?: (error: unknown) => void
}

export interface SSEInvalidatorClientEventMap {
  connected: CustomEvent<{ connectionId: string }>
  invalidate: CustomEvent<UniversalSignal | UniversalSignal[]>
  statuschange: CustomEvent<ConnectionStatus>
  error: CustomEvent<Event>
  rejected: CustomEvent<RejectedConnectionResponse>
  revoke: CustomEvent<RevokeEventDetail>
  renew: CustomEvent<RenewEventDetail>
  retriesexhausted: CustomEvent<{ attempts: number; maxRetries: number }>
}
