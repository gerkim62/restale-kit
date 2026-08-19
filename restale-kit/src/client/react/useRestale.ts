import { useContext, useEffect, useId } from 'react'
import { RestaleContext, type ConnectionSnapshot } from './RestaleProvider.js'
import { canonicalJsonSerialize } from '@/utils/canonical-hash.js'

export type { ConnectionSnapshot }

export interface UseRestaleOptions<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Page or component-specific context */
  clientContext?: TContext
  /**
   * Mode for resolving effective context with provider initialClientContext:
   * - 'merge' (default): Shallow merges { ...initialClientContext, ...clientContext }
   * - 'replace': Uses clientContext directly, ignoring initialClientContext
   */
  clientContextMode?: 'merge' | 'replace'
}

export interface UseRestaleResult<TEffective = Record<string, unknown>> {
  /** Unique ID for the active SSE connection instance */
  connectionId: string
  /** Current connection snapshot */
  connection: ConnectionSnapshot
  /** Current reconnection attempt count */
  attempt: number
  /** Helper booleans */
  isConnecting: boolean
  isConnected: boolean
  isReconnecting: boolean
  isClosed: boolean
  isError: boolean
  /** Manually trigger reconnect */
  reconnect: () => Promise<void>
  /** Manually close the connection */
  close: () => void
  /** The currently active effective client context */
  clientContext: TEffective
}

export function useRestale<
  TEffective = Record<string, unknown>,
>(): UseRestaleResult<TEffective>
export function useRestale<
  TContext extends Record<string, unknown>,
  TEffective = TContext,
>(options: UseRestaleOptions<TContext>): UseRestaleResult<TEffective>
export function useRestale(
  options?: UseRestaleOptions
): UseRestaleResult {
  const ctx = useContext(RestaleContext)
  if (!ctx) {
    throw new Error(
      'useRestale() must be used within a <RestaleProvider>. ' +
        'Wrap your component tree with <RestaleProvider url="..." onInvalidate={...}>.'
    )
  }

  const hookId = useId()
  const clientContext = options?.clientContext
  const mode = options?.clientContextMode ?? 'merge'
  const serialized = canonicalJsonSerialize(clientContext)
  const registerHookContext = ctx.registerHookContext
  const unregisterHookContext = ctx.unregisterHookContext

  useEffect(() => {
    if (clientContext !== undefined) {
      registerHookContext(hookId, clientContext, mode)
    } else {
      unregisterHookContext(hookId)
    }

    return () => {
      unregisterHookContext(hookId)
    }
  }, [hookId, serialized, mode, registerHookContext, unregisterHookContext])

  return {
    connectionId: ctx.connectionId,
    connection: ctx.connection,
    attempt: ctx.attempt,
    isConnecting: ctx.isConnecting,
    isConnected: ctx.isConnected,
    isReconnecting: ctx.isReconnecting,
    isClosed: ctx.isClosed,
    isError: ctx.isError,
    reconnect: ctx.reconnect,
    close: ctx.close,
    clientContext: ctx.clientContext,
  }
}
