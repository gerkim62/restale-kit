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
  // Stored as a ref-of-ref to keep the value stable across renders without
  // causing re-renders itself. The factory function is only called when
  // the url changes (i.e. when a new client must be created), not on every render.
  const urlRef = useRef<string | null>(null)
  const clientRef = useRef<SSEInvalidatorClient<TSignal> | null>(null)

  // Lazily create the client. We intentionally do this outside of useEffect so
  // that the client is available synchronously for useSyncExternalStore on the
  // first render. However, we guard with urlRef so the constructor only runs
  // when the url actually changes — not on every render pass — which prevents
  // the double-instantiation problem in React Strict Mode.
  if (clientRef.current === null || urlRef.current !== url) {
    // Close the previous client if url changed mid-lifecycle
    if (clientRef.current !== null) {
      clientRef.current.close()
    }
    clientRef.current = new SSEInvalidatorClient<TSignal>(url, {
      autoReconnect: opts.autoReconnect,
      reconnect: opts.reconnect,
      signalSchema: opts.signalSchema,
      withCredentials: opts.withCredentials,
    })
    urlRef.current = url
  }

  const client = clientRef.current

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
