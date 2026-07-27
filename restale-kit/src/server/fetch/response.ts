import type { InvalidateSignal, TargetForSignal, SignalTarget } from '@/types/protocol.js'
import type { SSEChannelOptions, SSEChannel } from '@/server/core/channel.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { buildSSETargetHeaders, extractConnectionId, extractLastEventId, extractRequestedTarget } from '@/server/transport-utils.js'
import type { SSEChannelGroup } from '@/server/core/channel-group.js'
import { mergeChannelDefaults } from '@/server/core/merge-channel-defaults.js'

/**
 * @internal
 * **WARNING: INTERNAL ONLY.** Do not invoke directly in application code.
 * Use `SSEChannelGroup.createFetchResponse(request, options)` instead.
 *
 * Creates an SSE `Response` for Fetch API runtimes (Hono, Bun, Deno, edge).
 */
export function internal_toSSEResponse<TSignal extends InvalidateSignal = InvalidateSignal>(
  request: Request,
  options: SSEChannelOptions,
  group?: SSEChannelGroup<TSignal, any, any>
): { response: Response; channel: SSEChannel<TSignal> } {
  const urlObj = new URL(request.url)
  const connectionId = extractConnectionId(urlObj.searchParams)
  const requestedTarget = extractRequestedTarget(urlObj.searchParams)

  const lastEventId =
    options.lastEventId ?? extractLastEventId((name) => request.headers.get(name))

  const baseOptions: SSEChannelOptions = {
    ...options,
    lastEventId,
    connectionId,
    requestedTarget: requestedTarget ?? options.requestedTarget,
  }

  const channelOptions = mergeChannelDefaults(baseOptions, group?.channelDefaults)
  if (channelOptions.target === undefined) {
    throw new Error('[createSSEChannel] target is required.')
  }
  const directOptions = { ...channelOptions, target: channelOptions.target }
  const channel = createSSEChannel<TSignal, SignalTarget | SignalTarget[] | string[]>(directOptions)

  const headers = buildSSETargetHeaders(channelOptions)

  const response = new Response(channel.stream, {
    headers,
  })

  // Wire up disconnect detection via the request's AbortSignal
  request.signal.addEventListener('abort', () => {
    channel.disconnect()
  })

  return { response, channel }
}

