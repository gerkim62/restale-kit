import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { InvalidateSignal } from '@/types/protocol.js'
import type { SSEChannelOptions, SSEChannel } from '@/server/core/channel.js'
import { createSSEChannel } from '@/server/core/channel.js'

/**
 * Attaches an SSE channel to a Node.js HTTP response.
 *
 * Sets the required SSE headers, pipes the channel's `ReadableStream` into
 * the response via `Readable.fromWeb()`, and wires up disconnect detection.
 *
 * Works with Express (`req, res`) and Fastify (`request.raw, reply.raw` —
 * call `reply.hijack()` first).
 */
export function attachSSE<TSignal extends InvalidateSignal = InvalidateSignal>(
  req: IncomingMessage,
  res: ServerResponse,
  options?: SSEChannelOptions<TSignal>
): SSEChannel<TSignal> {
  let lastEventId = options?.lastEventId
  if (lastEventId === undefined) {
    const header = req.headers['last-event-id']
    if (typeof header === 'string' && header !== '') {
      lastEventId = header
    } else if (Array.isArray(header) && header.length > 0 && typeof header[0] === 'string' && header[0] !== '') {
      lastEventId = header[0]
    }
  }

  const channelOptions: SSEChannelOptions<TSignal> = {
    ...options,
    lastEventId,
  }

  const channel = createSSEChannel<TSignal>(channelOptions)

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

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
