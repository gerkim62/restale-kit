import { useRef, useCallback, useSyncExternalStore, useEffect } from 'react'
import type { InvalidateSignal, SignalTarget } from '@/types/protocol.js'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'
import type {
  ConnectionStatus,
  ClientOptions,
  SSEInvalidatorClientEventMap,
  RevokeEventDetail,
  RejectedConnectionResponse,
  AdaptedInvalidateCallback,
} from '@/client/core/client-contracts.js'

/**
 * Options for `useReStale`.
 *
 * `TTarget` is inferred from the branded adapter callback passed as `onInvalidate`.
 * You do not need to pass `target` explicitly — it is inferred from the adapter.
 * If you *do* pass `target` explicitly it must match the adapter's target; a mismatch
 * is a compile-time error.
 *
 * @example — target inferred, no need to write it:
 * ```ts
 * const onInvalidate = useTanstackQueryAdapter(queryClient)
 * useReStale('/api/sse', { onInvalidate })
 * ```
 *
 * @example — explicit target that matches is fine:
 * ```ts
 * useReStale('/api/sse', { onInvalidate, target: 'tanstack-query' })
 * ```
 *
 * @example — explicit target mismatch → compile error:
 * ```ts
 * useReStale('/api/sse', { onInvalidate, target: 'swr' }) // ❌ Type error
 * ```
 */
export interface UseReStaleOptions<
  TTarget extends SignalTarget,
  TSignal extends InvalidateSignal = InvalidateSignal,
> extends Omit<ClientOptions, 'target'> {
  /** When true, the hook will not open a connection. Default: false. */
  disabled?: boolean
  /**
   * The branded adapter callback returned by `useTanstackQueryAdapter` or `useSwrAdapter`.
   * The `target` for the SSE connection is inferred from this callback's brand.
   */
  onInvalidate: AdaptedInvalidateCallback<TTarget, TSignal>
  /**
   * Explicit target override. Must match the adapter's target — a mismatch is a type error.
   * You usually don't need to pass this; it is inferred from `onInvalidate`.
   */
  target?: TTarget
  /**
   * Called when the server sends a terminal revocation frame.
   *
   * At this point the connection is already closed and auto-reconnect is suppressed.
   *
   * The `detail` is a `RevokeEventDetail` discriminated union. Branch on `detail.reason`
   * to handle specific revocation causes:
   *
   * ```ts
   * onRevoke: (detail) => {
   *   if (detail.reason === 'unsupported-target') {
   *     console.warn('Unsupported target. Server supports:', detail.supported)
   *   } else {
   *     logout()
   *   }
   * }
   * ```
   */
  onRevoke?: (detail: RevokeEventDetail) => void
  /** Called when the HTTP handshake returns a configured non-retryable status. */
  onRejected?: (response: RejectedConnectionResponse) => void
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
 * The SSE `target` is inferred automatically from the branded adapter callback
 * passed as `onInvalidate`.
 */
export function useReStale<
  TTarget extends SignalTarget,
  TSignal extends InvalidateSignal = InvalidateSignal,
>(
  url: string,
  opts: UseReStaleOptions<TTarget, TSignal>
): UseReStaleResult {
  const disabled = opts.disabled ?? false
  const onInvalidateRef = useRef(opts.onInvalidate)
  onInvalidateRef.current = opts.onInvalidate
  const onRevokeRef = useRef(opts.onRevoke)
  onRevokeRef.current = opts.onRevoke
  const onRejectedRef = useRef(opts.onRejected)
  onRejectedRef.current = opts.onRejected

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
    if (opts.debug) {
      const reason = urlRef.current === null
        ? `Hook mounted with URL: "${url}"`
        : `URL prop changed from "${urlRef.current}" to "${url}"`
      console.log(
        `[restale-kit][useReStale] Instantiating new SSEInvalidatorClient. Reason: ${reason}.`
      )
    }
    pendingClientRef.current = new SSEInvalidatorClient<TSignal>(url, {
      autoReconnect: opts.autoReconnect,
      reconnect: opts.reconnect,
      withCredentials: opts.withCredentials,
      debug: opts.debug,
      // Auto-infer target from the adapter's brand when not set explicitly.
      // opts.onInvalidate.__restaleTarget is stamped at runtime by makeAdaptedCallback
      // (e.g. useSwrAdapter → 'swr', useTanstackQueryAdapter → 'tanstack-query').
      // This ensures __restale_target__ is appended to the SSE URL and server-side
      // filtering activates automatically without requiring an explicit `target` prop.
      target: opts.target ?? opts.onInvalidate.__restaleTarget,
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
      if (opts.debug) {
        console.log(
          `[restale-kit][useReStale] Swapping active client to connectionId=${pending.connectionId} because URL changed to "${url}". Closing previous client connectionId=${previous.connectionId}.`
        )
      }
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

  // Wire up handshake rejection handling.
  useEffect(() => {
    const handler = (event: SSEInvalidatorClientEventMap<TSignal>['rejected']) => {
      onRejectedRef.current?.(event.detail)
    }

    client.addEventListener('rejected', handler)
    return () => {
      client.removeEventListener('rejected', handler)
    }
  }, [client])

  // Wire up onRevoke
  useEffect(() => {
    const handler = (event: SSEInvalidatorClientEventMap<TSignal>['revoke']) => {
      onRevokeRef.current?.(event.detail)
    }

    client.addEventListener('revoke', handler)
    return () => {
      client.removeEventListener('revoke', handler)
    }
  }, [client])

  // Open on mount / close on unmount
  useEffect(() => {
    if (disabled) {
      if (opts.debug) {
        console.log(
          `[restale-kit][useReStale] Skipping connect() for connectionId=${client.connectionId} because disabled=true.`
        )
      }
      return
    }

    if (opts.debug) {
      console.log(
        `[restale-kit][useReStale] Effect mounted for connectionId=${client.connectionId} (URL: "${client.endpointUrl}"). Reason: Component mounted or client instance changed. Calling connect().`
      )
    }

    void client.connect().catch((e: unknown) => {
      console.error('Failed to connect to SSE server:', e)
    })

    return () => {
      if (opts.debug) {
        console.log(
          `[restale-kit][useReStale] Effect unmounting for connectionId=${client.connectionId}. Reason: Component unmounting or client instance changing. Calling closeWithUnmount().`
        )
      }
      client.closeWithUnmount()
    }
  }, [client, disabled])

  const reconnect = useCallback(() => client.connect(), [client])
  const close = useCallback(() => { client.close() }, [client])

  return { connectionId: client.connectionId, connection, reconnect, close }
}
