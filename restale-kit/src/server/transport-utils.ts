import { PROTOCOL_CONSTANTS } from '@/utils/constants.js'

/**
 * Extracts and validates the internal `restaleKitRequestId` query parameter.
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
 */
export function extractLastEventId(
  getHeader: (name: string) => string | string[] | undefined | null
): string | undefined {
  const header =
    getHeader(PROTOCOL_CONSTANTS.LAST_EVENT_ID_HEADER) ||
    getHeader('Last-Event-ID')

  if (typeof header === 'string' && header !== '') {
    return header
  }
  if (
    Array.isArray(header) &&
    header.length > 0 &&
    typeof header[0] === 'string' &&
    header[0] !== ''
  ) {
    return header[0]
  }
  return undefined
}
