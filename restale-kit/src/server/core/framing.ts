import type { SSEInvalidateEvent } from '@/types/protocol.js'
import { SSE_EVENTS } from '@/utils/constants.js'

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
 * Sent by the server immediately before closing a connection intentionally
 * (e.g. logout, session expiry, ban). The client uses this to distinguish
 * an intentional server-initiated close from a transient network error,
 * suppressing automatic reconnection.
 */
export function formatRevokeFrame(reason: string): Uint8Array {
  const payload = JSON.stringify({ reason })
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
  const sanitizedMs = Math.max(0, Math.floor(retryMs))
  return encoder.encode(`retry: ${String(sanitizedMs)}\n\n`)
}

