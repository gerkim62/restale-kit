import type { InvalidateSignal } from '@/types/protocol.js'
import type { SSEChannelOptions, SSEChannel } from '@/server/core/channel.js'
import { createSSEChannel } from '@/server/core/channel.js'

/**
 * Creates an SSE `Response` for Fetch API runtimes (Hono, Bun, Deno, edge).
 *
 * Returns the `Response` to hand back to the framework, and the `SSEChannel`
 * to call `invalidate()` on from application logic elsewhere.
 *
 * Disconnect detection is wired to `request.signal.abort`.
 */
export function toSSEResponse<TSignal extends InvalidateSignal = InvalidateSignal>(
  request: Request,
  options?: SSEChannelOptions<TSignal>
): { response: Response; channel: SSEChannel<TSignal> } {
  let lastEventId = options?.lastEventId
  if (lastEventId === undefined) {
    const header = request.headers.get('Last-Event-ID')
    if (header !== null && header !== '') {
      lastEventId = header
    }
  }

  const channelOptions: SSEChannelOptions<TSignal> = {
    ...options,
    lastEventId,
  }

  const channel = createSSEChannel<TSignal>(channelOptions)

  const response = new Response(channel.stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })

  // Wire up disconnect detection via the request's AbortSignal
  request.signal.addEventListener('abort', () => {
    channel.disconnect()
  })

  return { response, channel }
}
