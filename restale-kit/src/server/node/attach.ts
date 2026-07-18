import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { InvalidateSignal } from '@/types/protocol.js'
import type { SSEChannelOptions, SSEChannel } from '@/server/core/channel.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { SSE_HEADERS } from '@/utils/constants.js'
import { extractConnectionId, extractLastEventId } from '@/server/transport-utils.js'

/**
 * Attaches an SSE channel to a Node.js HTTP response.
 *
 * Sets the required SSE headers, pipes the channel's `ReadableStream` into
 * the response via `Readable.fromWeb()`, and wires up disconnect detection.
 *
 * Throws an Error synchronously if the required `__restale_cid__` query
 * parameter is missing or invalid.
 *
 * Works with Express (`req, res`) and Fastify (`request.raw, reply.raw` —
 * call `reply.hijack()` first).
 */
export function attachSSE<TSignal extends InvalidateSignal = InvalidateSignal>(
  req: IncomingMessage,
  res: ServerResponse,
  options?: SSEChannelOptions<TSignal>
): SSEChannel<TSignal> {
  const rawUrl = req.url || '/'
  const searchIndex = rawUrl.indexOf('?')
  const searchParams = new URLSearchParams(searchIndex !== -1 ? rawUrl.slice(searchIndex) : '')
  const connectionId = extractConnectionId(searchParams)

  const lastEventId = options?.lastEventId ?? extractLastEventId((name) => req.headers[name])

  const channelOptions: SSEChannelOptions<TSignal> = {
    ...options,
    lastEventId,
    connectionId,
  }

  const channel = createSSEChannel<TSignal>(channelOptions)

  // Set SSE headers
  const headers: Record<string, string> = { ...SSE_HEADERS }
  if (options?.target !== undefined) {
    headers['X-ReStale-Target'] = Array.isArray(options.target)
      ? options.target.join(', ')
      : options.target
  }

  res.writeHead(200, headers)

  // Pipe the ReadableStream into the Node response
  // @ts-expect-error Node typings vs DOM ReadableStream typings compatibility
  const nodeReadable = Readable.fromWeb(channel.stream)
  nodeReadable.pipe(res)

  // Wire up disconnect detection
  req.on('close', () => {
    channel.disconnect()
  })

  return channel
}

