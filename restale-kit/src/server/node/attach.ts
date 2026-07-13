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
  const channel = createSSEChannel<TSignal>(options)

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  // Pipe the ReadableStream into the Node response
  // @ts-expect-error am unable to fix this 
  const nodeReadable = Readable.fromWeb(channel.stream)
  nodeReadable.pipe(res)

  // Wire up disconnect detection
  req.on('close', () => {
    channel.disconnect()
  })

  return channel
}
