import { PROTOCOL_CONSTANTS } from '@/utils/constants.js'

/**
 * Maximum accepted byte length for a Last-Event-ID header value.
 * Prevents a malicious client from forcing an expensive findIndex scan
 * across the event buffer with an arbitrarily long string.
 */
const MAX_LAST_EVENT_ID_LENGTH = 512

/**
 * Extracts and validates the internal `__restale_cid__` query parameter.
 * Throws an Error synchronously if missing or invalid; transport functions (`attachSSE`, `toSSEResponse`)
 * enforce this try/catch contract at the route boundary before attaching streams.
 */
export function extractConnectionId(searchParams: URLSearchParams): string {
  const connectionId = searchParams.get(PROTOCOL_CONSTANTS.RESTALE_REQUEST_ID_PARAM)
  if (!connectionId) {
    throw new Error(
      `Missing or invalid ${PROTOCOL_CONSTANTS.RESTALE_REQUEST_ID_PARAM} query parameter in request URL`
    )
  }
  return connectionId
}

/**
 * Extracts the Last-Event-ID header from a header lookup callback.
 * Returns `undefined` if the header is absent, empty, or exceeds the maximum
 * allowed length (to prevent DoS via oversized IDs triggering expensive buffer scans).
 */
export function extractLastEventId(
  getHeader: (name: string) => string | string[] | undefined | null
): string | undefined {
  const header =
    getHeader(PROTOCOL_CONSTANTS.LAST_EVENT_ID_HEADER) ||
    getHeader('Last-Event-ID')

  let value: string | undefined
  if (typeof header === 'string' && header !== '') {
    value = header
  } else if (
    Array.isArray(header) &&
    header.length > 0 &&
    typeof header[0] === 'string' &&
    header[0] !== ''
  ) {
    value = header[0]
  }

  if (value === undefined) return undefined

  if (value.length > MAX_LAST_EVENT_ID_LENGTH) {
    console.warn(
      `[WARN][extractLastEventId] Last-Event-ID header exceeds maximum length of ${String(MAX_LAST_EVENT_ID_LENGTH)} bytes ` +
      `(got ${String(value.length)}). Ignoring to prevent buffer scan DoS.`
    )
    return undefined
  }

  return value
}
