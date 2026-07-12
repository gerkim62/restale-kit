import { useRef, useCallback, useSyncExternalStore, useEffect } from 'react'
import type { InvalidateSignal } from '../core/types.js'
import { SSEInvalidatorClient } from '../client-core/client.js'
import type { ConnectionStatus, ClientOptions } from '../client-core/types.js'

/**
 * Options for `useReStale`, extending `ClientOptions` with React-specific fields.
 */
export interface UseReStaleOptions<TSignal extends InvalidateSignal = InvalidateSignal>
  extends ClientOptions<TSignal> {
  /** When true, the hook will not open a connection. Default: false. */
  disabled?: boolean
  /** Called on every received invalidation event. Typed by schema if provided. */
  onInvalidate?: (signal: TSignal | TSignal[]) => void
}

/**
 * Return value of `useReStale`.
 */
export interface UseReStaleResult {
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
  opts?: UseReStaleOptions<TSignal>
): UseReStaleResult {
  const disabled = opts?.disabled ?? false
  const onInvalidateRef = useRef(opts?.onInvalidate)
  onInvalidateRef.current = opts?.onInvalidate

  // Stable client reference — only recreated when url changes
  const clientRef = useRef<SSEInvalidatorClient<TSignal> | null>(null)
  if (!clientRef.current || clientRef.current['url'] !== url) {
    clientRef.current = new SSEInvalidatorClient<TSignal>(url, {
      autoReconnect: opts?.autoReconnect,
      reconnect: opts?.reconnect,
      signalSchema: opts?.signalSchema,
    })
  }

  const client = clientRef.current

  // useSyncExternalStore subscription
  const subscribe = useCallback(
    (callback: () => void) => {
      const handler = () => callback()
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
    const handler = (event: Event) => {
      const ce = event as CustomEvent<TSignal | TSignal[]>
      onInvalidateRef.current?.(ce.detail)
    }

    client.addEventListener('invalidate', handler)
    return () => {
      client.removeEventListener('invalidate', handler)
    }
  }, [client])

  // Open on mount / close on unmount
  useEffect(() => {
    if (disabled) return

    client.connect()

    return () => {
      client.close()
    }
  }, [client, disabled])

  const reconnect = useCallback(() => client.connect(), [client])
  const close = useCallback(() => client.close(), [client])

  return { connection, reconnect, close }
}
