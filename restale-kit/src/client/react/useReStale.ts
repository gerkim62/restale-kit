import { useRef, useCallback, useSyncExternalStore, useEffect } from 'react'
import type { InvalidateSignal } from '@/types/protocol.js'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'
import type { ConnectionStatus, ClientOptions, SSEInvalidatorClientEventMap } from '@/client/core/client-contracts.js'

/**
 * Options for `useReStale`, extending `ClientOptions` with React-specific fields.
 */
export interface UseReStaleOptions<TSignal extends InvalidateSignal = InvalidateSignal>
  extends ClientOptions<TSignal> {
  /** When true, the hook will not open a connection. Default: false. */
  disabled?: boolean
  /** Called on every received invalidation event. Typed by schema if provided. */
  onInvalidate: (signal: TSignal | TSignal[]) => void
  /**
   * Called when the server sends a terminal revocation frame.
   *
   * At this point the connection is already closed and auto-reconnect is suppressed.
   * Use this to log out the user, show a UI notice, or redirect.
   *
   * @param reason - The reason string from the revoke payload (e.g. `'logout'`, `'banned'`).
   */
  onRevoke?: (reason: string) => void
}

/**
 * Return value of `useReStale`.
 */
export interface UseReStaleResult {
  /** Unique ID generated for this SSE connection instance. */
  connectionId: string
  /** Current connection status. */
  connection: ConnectionStatus
  /** Manually trigger a reconnection. Resets backoff. */
  reconnect(): Promise<void>
  /** Manually close the connection. */
  close(): void
}

const CLOSED_UNMOUNT: ConnectionStatus = { status: 'closed', reason: 'unmount' }

/**
 * React hook that wraps `SSEInvalidatorClient` in a `useSyncExternalStore`
 * subscription.
 *
 * Opens on mount unless `disabled`. Closes with reason `'unmount'` on unmount.
 * Knows nothing about queries or caches — it only forwards `invalidate` events
 * to `onInvalidate`.
 */
export function useReStale<TSignal extends InvalidateSignal = InvalidateSignal>(
  url: string,
  opts: UseReStaleOptions<TSignal>
): UseReStaleResult {
  const disabled = opts.disabled ?? false
  const onInvalidateRef = useRef(opts.onInvalidate)
  onInvalidateRef.current = opts.onInvalidate
  const onRevokeRef = useRef(opts.onRevoke)
  onRevokeRef.current = opts.onRevoke

  // Stable client reference — only recreated when url changes.
  // We keep a separate pendingClientRef so the render phase never closes the committed
  // client. The swap is deferred to useEffect so an aborted/suspended render in
  // Concurrent Mode cannot tear down the live SSE connection.
  const urlRef = useRef<string | null>(null)
  const clientRef = useRef<SSEInvalidatorClient<TSignal> | null>(null)
  const pendingClientRef = useRef<SSEInvalidatorClient<TSignal> | null>(null)

  // On the first render, or when the url changes, build a new client and stage it in
  // pendingClientRef. The committed clientRef is left intact until the effect runs.
  if (urlRef.current !== url) {
    pendingClientRef.current = new SSEInvalidatorClient<TSignal>(url, {
      autoReconnect: opts.autoReconnect,
      reconnect: opts.reconnect,
      signalSchema: opts.signalSchema,
      withCredentials: opts.withCredentials,
    })
    urlRef.current = url
  }

  // For the very first render clientRef is still null — initialise it immediately so
  // useSyncExternalStore has a valid client on the first pass.
  if (clientRef.current === null) {
    clientRef.current = pendingClientRef.current
    pendingClientRef.current = null
  }

  const client = clientRef.current

  if(!client) {
    throw new Error('SSEInvalidatorClient is not initialized')
  }

  // useSyncExternalStore subscription
  const subscribe = useCallback(
    (callback: () => void) => {
      const handler = () => { callback() }
      client.addEventListener('statuschange', handler)
      return () => {
        client.removeEventListener('statuschange', handler)
      }
    },
    [client]
  )

  const getSnapshot = useCallback(() => client.status, [client])
  const getServerSnapshot = useCallback(() => CLOSED_UNMOUNT, [])

  const connection = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Commit the pending client swap after render. This runs after the browser has painted,
  // so an aborted concurrent render never closes the committed connection.
  useEffect(() => {
    const pending = pendingClientRef.current
    if (pending === null) return // no swap needed this cycle

    const previous = clientRef.current
    clientRef.current = pending
    pendingClientRef.current = null

    // Close the previous client only after the new one is committed.
    if (previous !== null && previous !== pending) {
      previous.close()
    }
    // Note: connect() for the new client is handled by the open/unmount effect below,
    // which also depends on `client`. Because clientRef is a plain ref (not state),
    // we trigger a re-render manually via the statuschange listener wired in subscribe().
  }, [url])

  // Wire up onInvalidate
  useEffect(() => {
    const handler = (event: SSEInvalidatorClientEventMap<TSignal>['invalidate']) => {
      onInvalidateRef.current(event.detail)
    }

    client.addEventListener('invalidate', handler)
    return () => {
      client.removeEventListener('invalidate', handler)
    }
  }, [client])

  // Wire up onRevoke
  useEffect(() => {
    const handler = (event: SSEInvalidatorClientEventMap<TSignal>['revoke']) => {
      onRevokeRef.current?.(event.detail.reason)
    }

    client.addEventListener('revoke', handler)
    return () => {
      client.removeEventListener('revoke', handler)
    }
  }, [client])

  // Open on mount / close on unmount
  useEffect(() => {
    if (disabled) return

    void client.connect().catch((e: unknown) => {
      console.error('Failed to connect to SSE server:', e)
    })

    return () => {
      client.closeWithUnmount()
    }
  }, [client, disabled])

  const reconnect = useCallback(() => client.connect(), [client])
  const close = useCallback(() => { client.close() }, [client])

  return { connectionId: client.connectionId, connection, reconnect, close }
}
