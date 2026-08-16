import { useRef, useCallback, useSyncExternalStore, useEffect, useState } from 'react'
import { SSEInvalidatorClient, isBlankUrl } from '@/client/core/sse-client.js'
import { canonicalJsonSerialize } from '@/utils/canonical-hash.js'
import type {
  ConnectionStatus,
  ClientOptions,
  SSEInvalidatorClientEventMap,
  RevokeEventDetail,
  RejectedConnectionResponse,
  AdaptedCallback,
} from '@/client/core/client-contracts.js'

/**
 * Options for `useReStale`.
 *
 * Adapters and raw callbacks both receive the universal signal union.
 *
 * @example
 * ```ts
 * const onInvalidate = useTanstackQueryAdapter(queryClient)
 * useReStale('/api/sse', { onInvalidate })
 * ```
 *
 */
export interface UseReStaleOptions extends ClientOptions {
  /** When true, the hook will not open a connection. Default: false. */
  disabled?: boolean
  /**
   * A branded adapter callback or a raw callback handling universal signals.
   */
  onInvalidate: AdaptedCallback | ((signal: import('@/types/protocol.js').UniversalSignal | import('@/types/protocol.js').UniversalSignal[]) => void)
  /**
   * Called when the server sends a terminal revocation frame.
   *
   * At this point the connection is already closed and auto-reconnect is suppressed.
   *
   * The `detail` is a `RevokeEventDetail` discriminated union. Branch on `detail.reason`
   * (`'token-expired'`, `'token-missing'`, `'logout'`, `'unauthorized'`, etc.)
   * to handle specific revocation causes:
   *
   * @example
   * ```ts
   * onRevoke: (detail) => {
   *   if (detail.reason === 'token-expired' || detail.reason === 'token-missing') {
   *     auth.refreshToken().then(() => reconnect())
   *   } else {
   *     logout()
   *   }
   * }
   * ```
   */
  onRevoke?: (detail: RevokeEventDetail) => void
  /** Called when the HTTP handshake returns a configured non-retryable status. */
  onRejected?: (response: RejectedConnectionResponse) => void
  /**
   * Called when automatic reconnection fails permanently after exhausting `maxRetries`.
   *
   * Accompanies the final status transition to `{ status: 'error' }`.
   */
  onRetriesExhausted?: (detail: { attempts: number; maxRetries: number }) => void
  /**
   * Client-supplied query-shaping context registered after each successful open.
   * Ordinary interfaces are accepted; the client validates that the runtime
   * value is JSON-serializable before sending it.
   */
  clientContext?: unknown
  /** Retry policy for automatic client-context registration. */
  clientContextSync?: {
    maxAttempts?: number
    retryDelayMs?: number
    onExhausted?: 'retryOnNextChange' | 'disableUntilReconnect'
  }
}

export type ConnectionSnapshot = ConnectionStatus & {
  readonly connectionId?: string
}

/**
 * Return value of `useReStale`.
 */
export interface UseReStaleResult {
  /** Unique ID generated for this SSE connection instance. */
  connectionId: string
  /** Current connection status. */
  connection: ConnectionSnapshot
  /** Current reconnect attempt count (0 during initial connection or after success). */
  attempt: number
  /** Helper boolean: true if status is 'connecting' and attempt === 0 */
  isConnecting: boolean
  /** Helper boolean: true if status is 'open' */
  isConnected: boolean
  /** Helper boolean: true if status is 'connecting' and attempt > 0 */
  isReconnecting: boolean
  /** Helper boolean: true if status is 'closed' */
  isClosed: boolean
  /** Helper boolean: true if status is 'error' */
  isError: boolean
  /** Manually trigger a reconnection. Resets backoff. */
  reconnect(): Promise<void>
  /** Manually close the connection. */
  close(): void
}

const CLOSED_UNMOUNT: ConnectionStatus = { status: 'closed', reason: 'unmount' }

function getClientIdentityKey(
  url: string,
  withCredentials: boolean | undefined,
  clientContextUrl: string | undefined
): string {
  return `${url}\u0000${String(withCredentials ?? false)}\u0000${clientContextUrl ?? ''}`
}

function toClientOptions(opts: ClientOptions): ClientOptions {
  return {
    ...(opts.autoReconnect !== undefined ? { autoReconnect: opts.autoReconnect } : {}),
    ...(opts.reconnect !== undefined ? { reconnect: opts.reconnect } : {}),
    ...(opts.withCredentials !== undefined ? { withCredentials: opts.withCredentials } : {}),
    ...(opts.debug !== undefined ? { debug: opts.debug } : {}),
    ...(opts.callback !== undefined ? { callback: opts.callback } : {}),
    ...(opts.onConnect !== undefined ? { onConnect: opts.onConnect } : {}),
    ...(opts.onDisconnect !== undefined ? { onDisconnect: opts.onDisconnect } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
    ...(opts.clientContextUrl !== undefined ? { clientContextUrl: opts.clientContextUrl } : {}),
  }
}

/**
 * React hook that wraps `SSEInvalidatorClient` in a `useSyncExternalStore`
 * subscription.
 *
 * Opens on mount unless `disabled`. Closes with reason `'unmount'` on unmount.
 * The hook accepts any callback that handles universal signals.
 */
export function useReStale(
  url: string,
  opts: UseReStaleOptions
): UseReStaleResult {
  const disabled = opts.disabled ?? false
  const onInvalidateRef = useRef(opts.onInvalidate)
  onInvalidateRef.current = opts.onInvalidate
  const onRevokeRef = useRef(opts.onRevoke)
  onRevokeRef.current = opts.onRevoke
  const onRejectedRef = useRef(opts.onRejected)
  onRejectedRef.current = opts.onRejected
  const onRetriesExhaustedRef = useRef(opts.onRetriesExhausted)
  onRetriesExhaustedRef.current = opts.onRetriesExhausted

  const identityKey = getClientIdentityKey(url, opts.withCredentials, opts.clientContextUrl)

  // Stable client reference — only recreated when connection identity changes.
  // We keep a separate pendingClientRef so the render phase never closes the committed
  // client. The swap is deferred to useEffect so an aborted/suspended render in
  // Concurrent Mode cannot tear down the live SSE connection.
  const identityRef = useRef<string | null>(null)
  const clientRef = useRef<SSEInvalidatorClient | null>(null)
  const pendingClientRef = useRef<SSEInvalidatorClient | null>(null)

  // On the first render, or when connection identity changes, build a new client and stage it in
  // pendingClientRef. If disabled=true and url is empty/falsy, bypass client creation.
  if (identityRef.current !== identityKey) {
    if (!disabled || !isBlankUrl(url)) {
      if (opts.debug) {
        const reason = identityRef.current === null
          ? `Hook mounted with URL: "${url}"`
          : `Connection identity changed for URL: "${url}"`
        console.log(
          `[restale-kit][useReStale] Instantiating new SSEInvalidatorClient. Reason: ${reason}.`
        )
      }
      pendingClientRef.current = new SSEInvalidatorClient(url, toClientOptions(opts))
      identityRef.current = identityKey
    }
  }

  // For the very first render clientRef is still null — initialise it if pendingClientRef is ready.
  if (clientRef.current === null && pendingClientRef.current !== null) {
    clientRef.current = pendingClientRef.current
    pendingClientRef.current = null
  }

  const client = clientRef.current
  useEffect(() => {
    if (!client) return
    client.updateRuntimeOptions(toClientOptions(opts))
  }, [
    client,
    opts.autoReconnect,
    opts.reconnect,
    opts.debug,
    opts.callback,
    opts.onConnect,
    opts.onDisconnect,
    opts.onError,
  ])

  // useSyncExternalStore subscription
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client) return () => {}
      const handler = () => { onStoreChange() }
      client.addEventListener('statuschange', handler)
      client.addEventListener('connected', handler)
      return () => {
        client.removeEventListener('statuschange', handler)
        client.removeEventListener('connected', handler)
      }
    },
    [client]
  )

  const snapshotRef = useRef<ConnectionSnapshot>(CLOSED_UNMOUNT)
  const lastStatusRef = useRef<ConnectionStatus | null>(null)
  const lastCidRef = useRef<string | undefined>(undefined)

  const getSnapshot = useCallback((): ConnectionSnapshot => {
    if (!client) return CLOSED_UNMOUNT
    if (client.status !== lastStatusRef.current || client.connectionId !== lastCidRef.current) {
      lastStatusRef.current = client.status
      lastCidRef.current = client.connectionId
      snapshotRef.current = {
        ...client.status,
        ...(client.connectionId !== undefined ? { connectionId: client.connectionId } : {}),
      }
    }
    return snapshotRef.current
  }, [client])
  const getServerSnapshot = useCallback((): ConnectionSnapshot => CLOSED_UNMOUNT, [])

  const connection = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Commit the pending client swap after render.
  useEffect(() => {
    const pending = pendingClientRef.current
    if (pending === null) return // no swap needed this cycle

    const previous = clientRef.current
    clientRef.current = pending
    pendingClientRef.current = null

    // Close the previous client only after the new one is committed.
    if (previous !== null && previous !== pending) {
      if (opts.debug) {
        console.log(
          `[restale-kit][useReStale] Swapping active client to connectionId=${pending.connectionId ?? 'none'} because connection identity changed for "${url}". Closing previous client connectionId=${previous.connectionId ?? 'none'}.`
        )
      }
      previous.close()
    }
  }, [identityKey, url, opts.debug])

  // Wire up onInvalidate
  useEffect(() => {
    if (!client) return
    const handler = (event: SSEInvalidatorClientEventMap['invalidate']) => {
      onInvalidateRef.current(event.detail)
    }

    client.addEventListener('invalidate', handler)
    return () => {
      client.removeEventListener('invalidate', handler)
    }
  }, [client])

  // Wire up handshake rejection handling.
  useEffect(() => {
    if (!client) return
    const handler = (event: SSEInvalidatorClientEventMap['rejected']) => {
      onRejectedRef.current?.(event.detail)
    }

    client.addEventListener('rejected', handler)
    return () => {
      client.removeEventListener('rejected', handler)
    }
  }, [client])

  // Wire up onRevoke
  useEffect(() => {
    if (!client) return
    const handler = (event: SSEInvalidatorClientEventMap['revoke']) => {
      onRevokeRef.current?.(event.detail)
    }

    client.addEventListener('revoke', handler)
    return () => {
      client.removeEventListener('revoke', handler)
    }
  }, [client])

  // Wire up onRetriesExhausted
  useEffect(() => {
    if (!client) return
    const handler = (event: SSEInvalidatorClientEventMap['retriesexhausted']) => {
      onRetriesExhaustedRef.current?.(event.detail)
    }

    client.addEventListener('retriesexhausted', handler)
    return () => {
      client.removeEventListener('retriesexhausted', handler)
    }
  }, [client])

  const contextSyncStateRef = useRef({
    wasOpen: false,
    lastSerialized: undefined as string | undefined,
    disabled: false,
    revision: 0,
  })
  const clientContext = opts.clientContext
  const clientContextRef = useRef(clientContext)
  clientContextRef.current = clientContext
  const serializedClientContext = canonicalJsonSerialize(clientContext)

  const [syncNonce, setSyncNonce] = useState(0)
  const triggerSync = useCallback(() => {
    const state = contextSyncStateRef.current
    state.lastSerialized = undefined
    setSyncNonce((n) => n + 1)
  }, [])
  const triggerSyncRef = useRef(triggerSync)
  triggerSyncRef.current = triggerSync

  // Context belongs to the server-side channel, so re-register it after every open.
  useEffect(() => {
    const state = contextSyncStateRef.current
    if (!client || connection.status !== 'open') {
      state.wasOpen = false
      return
    }

    if (!connection.connectionId) {
      return
    }

    const openedNow = !state.wasOpen
    state.wasOpen = true
    if (serializedClientContext === undefined) return
    if (clientContext === undefined) return
    const contextToSync = clientContext
    if (openedNow) state.disabled = false
    if (state.disabled || (!openedNow && state.lastSerialized === serializedClientContext)) return
    state.lastSerialized = serializedClientContext
    const revision = ++state.revision

    let active = true
    const maxAttempts = Math.max(1, Math.floor(opts.clientContextSync?.maxAttempts ?? 2))
    const retryDelayMs = Math.max(0, Math.floor(opts.clientContextSync?.retryDelayMs ?? 200))
    const onExhausted = opts.clientContextSync?.onExhausted ?? 'retryOnNextChange'
    const sync = async (): Promise<void> => {
      for (let attempt = 0; attempt < maxAttempts && active; attempt++) {
        try {
          const result = await client.updateClientContext(contextToSync, { revision })
          if (result.updated) return
        } catch {
          // The final error below is intentionally the only observable error surface.
        }
        if (attempt + 1 < maxAttempts && active) {
          await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs))
        }
      }
      if (!active) return
      if (onExhausted === 'disableUntilReconnect') state.disabled = true
      console.error('[restale-kit][useReStale] Failed to synchronize clientContext.')
      try {
        onInvalidateRef.current({ key: [] })
      } catch {
        // onInvalidate error surface handled by caller
      }
    }
    void sync()
    return () => { active = false }
  }, [client, connection.status, connection.connectionId, serializedClientContext, clientContext, opts.clientContextSync, syncNonce])

  // Open on mount / close on unmount
  useEffect(() => {
    if (!client || disabled) {
      if (opts.debug && client) {
        console.log(
          `[restale-kit][useReStale] Skipping connect() for connectionId=${client.connectionId ?? 'none'} because disabled=true.`
        )
      }
      return
    }

    if (opts.debug) {
      console.log(
        `[restale-kit][useReStale] Effect mounted for connectionId=${client.connectionId ?? 'none'} (URL: "${client.endpointUrl}"). Reason: Component mounted or client instance changed. Calling connect().`
      )
    }

    void client.connect().catch((e: unknown) => {
      if (
        (typeof Event !== 'undefined' && e instanceof Event && (e.type === 'close' || e.type === 'error')) ||
        client.status.status === 'closed'
      ) {
        if (opts.debug) {
          console.log(
            `[restale-kit][useReStale] connect() promise rejected for connectionId=${client.connectionId ?? 'none'} due to component unmount/close.`
          )
        }
        return
      }
      console.error('Failed to connect to SSE server:', e)
    })

    return () => {
      if (opts.debug) {
        console.log(
          `[restale-kit][useReStale] Effect unmounting for connectionId=${client.connectionId ?? 'none'}. Reason: Component unmounting or client instance changing. Calling closeWithUnmount().`
        )
      }
      client.closeWithUnmount()
    }
  }, [client, disabled])

  const reconnect = useCallback(() => (client ? client.connect() : Promise.resolve()), [client])
  const close = useCallback(() => { client?.close() }, [client])

  const attempt = client ? client.attempt : 0
  const isConnecting = connection.status === 'connecting' && attempt === 0
  const isConnected = connection.status === 'open'
  const isReconnecting = connection.status === 'connecting' && attempt > 0
  const isClosed = connection.status === 'closed'
  const isError = connection.status === 'error'

  return {
    connectionId: client?.connectionId ?? '',
    connection,
    attempt,
    isConnecting,
    isConnected,
    isReconnecting,
    isClosed,
    isError,
    reconnect,
    close,
  }
}
