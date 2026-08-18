import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { SSEInvalidatorClient, isBlankUrl } from '@/client/core/sse-client.js'
import { canonicalJsonSerialize } from '@/utils/canonical-hash.js'
import type {
  ConnectionStatus,
  ClientOptions,
  SSEInvalidatorClientEventMap,
  RevokeEventDetail,
  RejectedConnectionResponse,
  AdaptedCallback,
  AutoReconnectOptions,
  ReconnectOptions,
} from '@/client/core/client-contracts.js'
import type { UniversalSignal } from '@/types/protocol.js'

export type ConnectionSnapshot = ConnectionStatus & {
  readonly connectionId?: string
}

export interface RestaleProviderProps<
  TDefaults extends Record<string, unknown> = Record<string, unknown>,
> {
  /** The SSE endpoint URL */
  url: string
  /** Invalidation handler (e.g., tanstackQueryAdapter(queryClient) or swrAdapter(mutate)) */
  onInvalidate: AdaptedCallback | ((signal: UniversalSignal | UniversalSignal[]) => void)

  // --- Connection Configuration ---
  /** When true, connection is not opened. Default: false */
  disabled?: boolean
  /** Whether to send credentials with SSE requests. Default: false */
  withCredentials?: boolean
  /** Auto reconnect policy */
  autoReconnect?: boolean | AutoReconnectOptions
  /** Backoff and retry policy */
  reconnect?: ReconnectOptions
  /** Enable debug logging */
  debug?: boolean
  /** Endpoint for client-context registration if different from url */
  clientContextUrl?: string

  // --- Event Callbacks ---
  onRevoke?: (detail: RevokeEventDetail) => void
  onRejected?: (response: RejectedConnectionResponse) => void
  onRetriesExhausted?: (detail: { attempts: number; maxRetries: number }) => void
  onConnect?: (event: Event) => void
  onDisconnect?: (event: Event) => void
  onError?: (error: unknown) => void

  // --- Client Context Configuration ---
  /** Optional base context object (e.g. { userId, tenantId }) */
  initialClientContext?: TDefaults
  /** Retry policy for client context synchronization */
  clientContextSync?: {
    maxAttempts?: number
    retryDelayMs?: number
    onExhausted?: 'retryOnNextChange' | 'disableUntilReconnect'
  }

  children: React.ReactNode
}

export interface RestaleContextValue {
  connectionId: string
  connection: ConnectionSnapshot
  attempt: number
  isConnecting: boolean
  isConnected: boolean
  isReconnecting: boolean
  isClosed: boolean
  isError: boolean
  reconnect(): Promise<void>
  close(): void
  clientContext: Record<string, unknown>
  registerHookContext(
    id: string,
    context: Record<string, unknown> | undefined,
    mode: 'merge' | 'replace'
  ): void
  unregisterHookContext(id: string): void
}

export const RestaleContext = createContext<RestaleContextValue | null>(null)

const CLOSED_UNMOUNT: ConnectionStatus = { status: 'closed', reason: 'unmount' }

function getClientIdentityKey(
  url: string,
  withCredentials: boolean | undefined,
  clientContextUrl: string | undefined
): string {
  return `${url}\u0000${String(withCredentials ?? false)}\u0000${clientContextUrl ?? ''}`
}

function toClientOptions(opts: RestaleProviderProps<any>): ClientOptions {
  return {
    ...(opts.autoReconnect !== undefined ? { autoReconnect: opts.autoReconnect } : {}),
    ...(opts.reconnect !== undefined ? { reconnect: opts.reconnect } : {}),
    ...(opts.withCredentials !== undefined ? { withCredentials: opts.withCredentials } : {}),
    ...(opts.debug !== undefined ? { debug: opts.debug } : {}),
    ...(opts.onConnect !== undefined ? { onConnect: opts.onConnect } : {}),
    ...(opts.onDisconnect !== undefined ? { onDisconnect: opts.onDisconnect } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
    ...(opts.clientContextUrl !== undefined ? { clientContextUrl: opts.clientContextUrl } : {}),
  }
}

interface HookContextEntry {
  id: string
  context: Record<string, unknown> | undefined
  mode: 'merge' | 'replace'
}

export function RestaleProvider<
  TDefaults extends Record<string, unknown> = Record<string, unknown>,
>(props: RestaleProviderProps<TDefaults>): React.JSX.Element {
  const {
    url,
    onInvalidate,
    disabled = false,
    withCredentials,
    autoReconnect,
    reconnect: reconnectOpts,
    debug = false,
    clientContextUrl,
    onRevoke,
    onRejected,
    onRetriesExhausted,
    onConnect,
    onDisconnect,
    onError,
    initialClientContext,
    clientContextSync,
    children,
  } = props

  const onInvalidateRef = useRef(onInvalidate)
  onInvalidateRef.current = onInvalidate
  const onRevokeRef = useRef(onRevoke)
  onRevokeRef.current = onRevoke
  const onRejectedRef = useRef(onRejected)
  onRejectedRef.current = onRejected
  const onRetriesExhaustedRef = useRef(onRetriesExhausted)
  onRetriesExhaustedRef.current = onRetriesExhausted
  const onConnectRef = useRef(onConnect)
  onConnectRef.current = onConnect
  const onDisconnectRef = useRef(onDisconnect)
  onDisconnectRef.current = onDisconnect
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const identityKey = getClientIdentityKey(url, withCredentials, clientContextUrl)

  const identityRef = useRef<string | null>(null)
  const clientRef = useRef<SSEInvalidatorClient | null>(null)
  const pendingClientRef = useRef<SSEInvalidatorClient | null>(null)

  if (identityRef.current !== identityKey) {
    if (!disabled || !isBlankUrl(url)) {
      if (debug) {
        const reason =
          identityRef.current === null
            ? `Provider mounted with URL: "${url}"`
            : `Connection identity changed for URL: "${url}"`
        console.log(
          `[restale-kit][RestaleProvider] Instantiating new SSEInvalidatorClient. Reason: ${reason}.`
        )
      }
      pendingClientRef.current = new SSEInvalidatorClient(url, toClientOptions(props))
      identityRef.current = identityKey
    }
  }

  if (clientRef.current === null && pendingClientRef.current !== null) {
    clientRef.current = pendingClientRef.current
    pendingClientRef.current = null
  }

  const client = clientRef.current

  // Commit swap after render if identity changed
  useEffect(() => {
    const pending = pendingClientRef.current
    if (pending === null) return

    const previous = clientRef.current
    clientRef.current = pending
    pendingClientRef.current = null

    if (previous !== null && previous !== pending) {
      if (debug) {
        console.log(
          `[restale-kit][RestaleProvider] Swapping active client. Closing previous client (connectionId: ${previous.connectionId ?? 'none'}).`
        )
      }
      previous.close()
    }
  }, [identityKey, debug])

  // Update runtime options when non-identity props change
  useEffect(() => {
    if (!client) return
    client.updateRuntimeOptions(toClientOptions(props))
  }, [
    client,
    autoReconnect,
    reconnectOpts,
    debug,
    onConnect,
    onDisconnect,
    onError,
  ])

  // useSyncExternalStore subscription
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client) return () => {}
      const handler = () => {
        onStoreChange()
      }
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

  // Event listeners wiring
  useEffect(() => {
    if (!client) return
    const onInvalidateHandler = (event: SSEInvalidatorClientEventMap['invalidate']) => {
      onInvalidateRef.current(event.detail)
    }
    const onRejectedHandler = (event: SSEInvalidatorClientEventMap['rejected']) => {
      onRejectedRef.current?.(event.detail)
    }
    const onRevokeHandler = (event: SSEInvalidatorClientEventMap['revoke']) => {
      onRevokeRef.current?.(event.detail)
    }
    const onRetriesExhaustedHandler = (event: SSEInvalidatorClientEventMap['retriesexhausted']) => {
      onRetriesExhaustedRef.current?.(event.detail)
    }

    client.addEventListener('invalidate', onInvalidateHandler)
    client.addEventListener('rejected', onRejectedHandler)
    client.addEventListener('revoke', onRevokeHandler)
    client.addEventListener('retriesexhausted', onRetriesExhaustedHandler)

    return () => {
      client.removeEventListener('invalidate', onInvalidateHandler)
      client.removeEventListener('rejected', onRejectedHandler)
      client.removeEventListener('revoke', onRevokeHandler)
      client.removeEventListener('retriesexhausted', onRetriesExhaustedHandler)
    }
  }, [client])

  // Connection lifecycle: connect on mount, closeWithUnmount on unmount
  useEffect(() => {
    if (!client || disabled) return

    void client.connect().catch((e: unknown) => {
      if (
        (typeof Event !== 'undefined' && e instanceof Event && (e.type === 'close' || e.type === 'error')) ||
        client.status.status === 'closed'
      ) {
        return
      }
      console.error('Failed to connect to SSE server:', e)
    })

    return () => {
      client.closeWithUnmount()
    }
  }, [client, disabled])

  // --- Dynamic Hook Context Stack ---
  const [hookEntries, setHookEntries] = useState<HookContextEntry[]>([])

  const registerHookContext = useCallback(
    (id: string, context: Record<string, unknown> | undefined, mode: 'merge' | 'replace') => {
      setHookEntries((prev) => {
        const filtered = prev.filter((entry) => entry.id !== id)
        return [...filtered, { id, context, mode }]
      })
    },
    []
  )

  const unregisterHookContext = useCallback((id: string) => {
    setHookEntries((prev) => prev.filter((entry) => entry.id !== id))
  }, [])

  // Compute effective context
  const activeHookEntry = hookEntries.length > 0 ? hookEntries[hookEntries.length - 1] : undefined
  const effectiveContext = useMemo((): Record<string, unknown> => {
    const base = initialClientContext ?? {}
    if (!activeHookEntry || activeHookEntry.context === undefined) {
      return base
    }
    if (activeHookEntry.mode === 'replace') {
      return activeHookEntry.context
    }
    return { ...base, ...activeHookEntry.context }
  }, [initialClientContext, activeHookEntry])

  const serializedContext = canonicalJsonSerialize(effectiveContext)

  // Context Synchronization to Server
  const contextSyncStateRef = useRef({
    wasOpen: false,
    lastSerialized: undefined as string | undefined,
    disabled: false,
    revision: 0,
  })

  useEffect(() => {
    const state = contextSyncStateRef.current
    if (!client || connection.status !== 'open' || !connection.connectionId) {
      state.wasOpen = false
      return
    }

    const openedNow = !state.wasOpen
    state.wasOpen = true

    if (serializedContext === undefined || effectiveContext === undefined) return
    if (openedNow) state.disabled = false
    if (state.disabled || (!openedNow && state.lastSerialized === serializedContext)) return

    state.lastSerialized = serializedContext
    const revision = ++state.revision

    let active = true
    const maxAttempts = Math.max(1, Math.floor(clientContextSync?.maxAttempts ?? 2))
    const retryDelayMs = Math.max(0, Math.floor(clientContextSync?.retryDelayMs ?? 200))
    const onExhausted = clientContextSync?.onExhausted ?? 'retryOnNextChange'

    const sync = async (): Promise<void> => {
      for (let attempt = 0; attempt < maxAttempts && active; attempt++) {
        try {
          const result = await client.updateClientContext(effectiveContext, { revision })
          if (result.updated) return
        } catch {
          // Retry
        }
        if (attempt + 1 < maxAttempts && active) {
          await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs))
        }
      }
      if (!active) return
      if (onExhausted === 'disableUntilReconnect') state.disabled = true
      console.error('[restale-kit][RestaleProvider] Failed to synchronize clientContext.')
      try {
        onInvalidateRef.current({ key: [] })
      } catch {
        // Handled by caller
      }
    }

    void sync()
    return () => {
      active = false
    }
  }, [
    client,
    connection.status,
    connection.connectionId,
    serializedContext,
    effectiveContext,
    clientContextSync,
  ])

  const reconnect = useCallback(() => (client ? client.connect() : Promise.resolve()), [client])
  const close = useCallback(() => {
    client?.close()
  }, [client])

  const attempt = client ? client.attempt : 0
  const isConnecting = connection.status === 'connecting' && attempt === 0
  const isConnected = connection.status === 'open'
  const isReconnecting = connection.status === 'connecting' && attempt > 0
  const isClosed = connection.status === 'closed'
  const isError = connection.status === 'error'

  const contextValue: RestaleContextValue = useMemo(
    () => ({
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
      clientContext: effectiveContext,
      registerHookContext,
      unregisterHookContext,
    }),
    [
      client?.connectionId,
      connection,
      attempt,
      isConnecting,
      isConnected,
      isReconnecting,
      isClosed,
      isError,
      reconnect,
      close,
      effectiveContext,
      registerHookContext,
      unregisterHookContext,
    ]
  )

  return <RestaleContext.Provider value={contextValue}>{children}</RestaleContext.Provider>
}
