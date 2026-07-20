import type { InvalidateSignal } from '@/types/protocol.js'
import type { SSEChannelOptions, SSEChannel } from '@/server/core/channel.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { SSE_HEADERS, SSE_RESPONSE_HEADERS } from '@/utils/constants.js'
import { extractConnectionId, extractLastEventId, extractRequestedTarget } from '@/server/transport-utils.js'
import type { SSEChannelGroup } from '@/server/core/channel-group.js'
import { mergeChannelDefaults } from '@/server/core/merge-channel-defaults.js'

/**
 * Creates an SSE `Response` for Fetch API runtimes (Hono, Bun, Deno, edge).
 *
 * Returns the `Response` to hand back to the framework, and the `SSEChannel`
 * to call `invalidate()` on from application logic elsewhere.
 *
 * Throws an Error synchronously if the required `__restale_cid__` query
 * parameter is missing or invalid.
 *
 * Disconnect detection is wired to `request.signal.abort`.
 *
 * @param group - Optional `SSEChannelGroup` whose `channelDefaults` are merged into
 *   `options` before creating the channel. Per-channel values always win over defaults.
 */
export function toSSEResponse<TSignal extends InvalidateSignal = InvalidateSignal>(
  request: Request,
  options: SSEChannelOptions<TSignal>,
  group?: SSEChannelGroup<TSignal, unknown>
): { response: Response; channel: SSEChannel<TSignal> } {
  const urlObj = new URL(request.url)
  const connectionId = extractConnectionId(urlObj.searchParams)
  const requestedTarget = extractRequestedTarget(urlObj.searchParams)

  const lastEventId =
    options.lastEventId ?? extractLastEventId((name) => request.headers.get(name))

  const baseOptions: SSEChannelOptions<TSignal> = {
    ...options,
    lastEventId,
    connectionId,
    requestedTarget: requestedTarget ?? options.requestedTarget,
  }

  const channelOptions = mergeChannelDefaults(baseOptions, group?.channelDefaults)

  const channel = createSSEChannel<TSignal>(channelOptions)

  // Build the supported targets list from options.target for the X-ReStale-Supported header
  const supportedTargets = Array.isArray(options.target)
    ? options.target.join(', ')
    : options.target

  const headers: Record<string, string> = {
    ...SSE_HEADERS,
    [SSE_RESPONSE_HEADERS.RESTALE_TARGET]: Array.isArray(options.target)
      ? options.target.join(', ')
      : options.target,
    [SSE_RESPONSE_HEADERS.RESTALE_SUPPORTED]: supportedTargets,
  }

  const response = new Response(channel.stream, {
    headers,
  })

  // Wire up disconnect detection via the request's AbortSignal
  request.signal.addEventListener('abort', () => {
    channel.disconnect()
  })

  return { response, channel }
}

