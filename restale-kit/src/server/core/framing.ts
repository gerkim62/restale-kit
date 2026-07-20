import type { SSEInvalidateEvent } from '@/types/protocol.js'
import { SSE_EVENTS } from '@/utils/constants.js'

/**
 * Payload carried in a `renew` SSE frame.
 * Both fields are server-supplied so the client has no need to apply its own defaults.
 */
export interface RenewFramePayload {
  reason: 'deadline'
  maxAttempts: number
  retryDelayMs: number
}

const encoder = new TextEncoder()

/**
 * Formats an invalidation signal (or batch) as an SSE event frame.
 *
 * Produces exactly:
 * ```
 * event: invalidate\n
 * data: <JSON payload line 1>\n
 * data: <JSON payload line 2>\n   (only if JSON contains newlines)
 * \n
 * ```
 *
 * Per the SSE spec, each `data:` line's value is concatenated with a newline
 * by the browser before being delivered to the event listener. Multi-line JSON
 * (e.g. from a custom `.toJSON()`) is split across multiple `data:` lines so
 * the frame is never broken by embedded newline characters.
 */
export function formatInvalidateFrame(signal: SSEInvalidateEvent, id?: string | number): Uint8Array {
  const json = JSON.stringify(signal)
  const sanitizedId = id !== undefined ? String(id).replace(/[\r\n]/g, '') : undefined
  const idPrefix = sanitizedId !== undefined && sanitizedId !== '' ? `id: ${sanitizedId}\n` : ''
  // Split on any newline variant and prefix each line with "data: " per the SSE spec.
  // JSON.stringify does not emit raw newlines for standard values, but a custom .toJSON()
  // could — splitting ensures the frame is always structurally valid.
  const dataLines = json.split(/\r\n|\r|\n/).map((line) => `data: ${line}`).join('\n')
  return encoder.encode(`${idPrefix}event: ${SSE_EVENTS.INVALIDATE}\n${dataLines}\n\n`)
}

/**
 * Formats an SSE keepalive comment.
 *
 * Produces exactly:
 * ```
 * : keepalive\n
 * \n
 * ```
 *
 * Standard SSE comments (`:` prefix) are silently ignored by `EventSource`.
 * Used to prevent proxies/load balancers from dropping idle connections.
 */
export function formatKeepalive(): Uint8Array {
  return encoder.encode(`: ${SSE_EVENTS.KEEPALIVE}\n\n`)
}

/**
 * Formats a terminal revocation event frame.
 *
 * Produces exactly:
 * ```
 * event: revoke\n
 * data: {"reason":"<reason>"}\n
 * \n
 * ```
 *
 * When `details` is provided (e.g. for `reason: 'unsupported-target'`), the frame includes
 * structured fields so the client can report exactly why the connection was rejected:
 * ```
 * event: revoke\n
 * data: {"reason":"unsupported-target","requested":"rtk-query","supported":["swr","tanstack-query"]}\n
 * \n
 * ```
 *
 * Sent by the server immediately before closing a connection intentionally
 * (e.g. logout, session expiry, ban, unsupported target). The client uses this to distinguish
 * an intentional server-initiated close from a transient network error,
 * suppressing automatic reconnection.
 */
export function formatRevokeFrame(
  reason: string,
  details?: { requested: string; supported: string[] }
): Uint8Array {
  const payload = details !== undefined
    ? JSON.stringify({ reason, requested: details.requested, supported: details.supported })
    : JSON.stringify({ reason })
  return encoder.encode(`event: ${SSE_EVENTS.REVOKE}\ndata: ${payload}\n\n`)
}

/**
 * Formats a standard SSE retry frame.
 *
 * Produces:
 * ```
 * retry: <retryMs>\n
 * \n
 * ```
 *
 * Instructs standard EventSource clients to set their native reconnection delay.
 */
export function formatRetryFrame(retryMs: number): Uint8Array {
  if (!Number.isFinite(retryMs)) {
    throw new Error('[formatRetryFrame] retryMs must be a finite number.')
  }
  const sanitizedMs = Math.max(0, Math.floor(retryMs))
  return encoder.encode(`retry: ${String(sanitizedMs)}\n\n`)
}


/**
 * Formats a `renew` SSE frame.
 *
 * Sent by the server when a connection's deadline fires with `onDeadline: 'reconnect'`
 * (the default). It is a sibling of the `revoke` frame — same mechanism, opposite meaning:
 * - `revoke` asserts "you are unauthorized, do not reconnect."
 * - `renew` asserts "this connection is ending on purpose, but you are NOT being told you
 *   are unauthorized — please make `maxAttempts` confirmatory reconnect attempt(s)."
 *
 * Produces exactly:
 * ```
 * event: renew\n
 * data: {"reason":"deadline","maxAttempts":1,"retryDelayMs":250}\n
 * \n
 * ```
 *
 * `maxAttempts` and `retryDelayMs` are server-supplied rather than client-side defaults
 * because the server knows the deadline policy; the client reads them as-is (spec §4.1.2).
 */
export function formatRenewFrame(maxAttempts: number, retryDelayMs: number): Uint8Array {
  const payload: RenewFramePayload = {
    reason: 'deadline',
    maxAttempts: Math.max(1, Math.floor(maxAttempts)),
    retryDelayMs: Math.max(0, Math.floor(retryDelayMs)),
  }
  return encoder.encode(`event: ${SSE_EVENTS.RENEW}\ndata: ${JSON.stringify(payload)}\n\n`)
}
