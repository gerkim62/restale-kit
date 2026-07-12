import type { SSEInvalidateEvent } from '../shared/types.js'

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
export function formatInvalidateFrame(signal: SSEInvalidateEvent): Uint8Array {
  const json = JSON.stringify(signal)
  return encoder.encode(`event: invalidate\ndata: ${json}\n\n`)
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
