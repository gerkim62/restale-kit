import { PROTOCOL_CONSTANTS, SSE_HEADERS } from '@/utils/constants.js'

const MAX_LAST_EVENT_ID_LENGTH = 512

export function extractConnectionId(searchParams: URLSearchParams): string {
  const connectionId = searchParams.get(PROTOCOL_CONSTANTS.RESTALE_REQUEST_ID_PARAM)
  if (connectionId === null || connectionId.replace(/[\s\u200B\u200C\u200D]/gu, '') === '') {
    throw new Error(`Missing or invalid ${PROTOCOL_CONSTANTS.RESTALE_REQUEST_ID_PARAM} query parameter in request URL`)
  }
  return connectionId
}

export function extractLastEventId(
  getHeader: (name: string) => string | string[] | undefined | null,
): string | undefined {
  const header = getHeader(PROTOCOL_CONSTANTS.LAST_EVENT_ID_HEADER) ?? getHeader('Last-Event-ID')
  const value = typeof header === 'string' ? header : Array.isArray(header) ? header[0] : undefined
  if (!value || value.length > MAX_LAST_EVENT_ID_LENGTH) return undefined
  return value
}

/** Standard headers for every SSE response. */
export function buildSSEHeaders(): Record<string, string> {
  return { ...SSE_HEADERS }
}
