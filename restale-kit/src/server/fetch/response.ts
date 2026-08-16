import type { SSEChannelTransportOptions, SSEChannel } from '@/server/core/channel.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { buildSSEHeaders, extractConnectionId, extractLastEventId } from '@/server/transport-utils.js'
import type { SSEChannelGroup } from '@/server/core/channel-group.js'
import { mergeChannelDefaults } from '@/server/core/merge-channel-defaults.js'

/**
 * @internal
 * **WARNING: INTERNAL ONLY.** Do not invoke directly in application code.
 * Use `SSEChannelGroup.createFetchResponse(request, options)` instead.
 *
 * Creates an SSE `Response` for Fetch API runtimes (Hono, Bun, Deno, edge).
 */
export function internal_toSSEResponse(
  request: Request,
  options: SSEChannelTransportOptions,
  group?: Pick<SSEChannelGroup, 'channelDefaults' | 'eventStore'>
): { response: Response; channel: SSEChannel } {
  const urlObj = new URL(request.url)
  const connectionId =
    options.connectionId !== undefined
      ? options.connectionId
      : extractConnectionId(urlObj.searchParams)
  const lastEventId =
    options.lastEventId ?? extractLastEventId((name) => request.headers.get(name))

  const { eventStore: optionEventStore, ...restOptions } = options
  const effectiveEventStore = optionEventStore ?? group?.eventStore
  const baseOptions: SSEChannelTransportOptions = {
    ...restOptions,
    connectionId,
    ...(lastEventId !== undefined ? { lastEventId } : {}),
    ...(effectiveEventStore !== undefined ? { eventStore: effectiveEventStore } : {}),
  }

  const channelOptions = mergeChannelDefaults(baseOptions, group?.channelDefaults)
  const channel = createSSEChannel(channelOptions)

  const headers = buildSSEHeaders()

  const response = new Response(channel.stream, {
    headers,
  })

  // Wire up disconnect detection via the request's AbortSignal
  request.signal.addEventListener('abort', () => {
    channel.disconnect()
  })

  return { response, channel }
}
