import type { SSEInvalidateEvent } from '@/types/protocol.js'

const encoder = new TextEncoder()

/**
 * Formats an invalidation signal (or batch) as an SSE event frame.
 *
 * Produces exactly:
 * ```
 * event: invalidate\n
 * data: <JSON payload>\n
 * \n
 * ```
 *
 * The entire payload is sent as one `data:` line — no splitting across multiple lines.
 */
export function formatInvalidateFrame(signal: SSEInvalidateEvent, id?: string | number): Uint8Array {
  const json = JSON.stringify(signal)
  const sanitizedId = id !== undefined ? String(id).replace(/[\r\n]/g, '') : undefined
  const idPrefix = sanitizedId !== undefined && sanitizedId !== '' ? `id: ${sanitizedId}\n` : ''
  return encoder.encode(`${idPrefix}event: invalidate\ndata: ${json}\n\n`)
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
  return encoder.encode(': keepalive\n\n')
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
  const sanitizedReason = reason.replace(/[\r\n"\\]/g, (c) => {
    if (c === '"') return '\\"'
    if (c === '\\') return '\\\\'
    return ''
  })
  return encoder.encode(`event: revoke\ndata: {"reason":"${sanitizedReason}"}\n\n`)
}
