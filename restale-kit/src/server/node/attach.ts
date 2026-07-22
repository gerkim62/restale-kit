import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { InvalidateSignal } from '@/types/protocol.js'
import type { SSEChannelOptions, SSEChannel } from '@/server/core/channel.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { SSE_HEADERS, SSE_RESPONSE_HEADERS } from '@/utils/constants.js'
import { extractConnectionId, extractLastEventId, extractRequestedTarget } from '@/server/transport-utils.js'
import type { SSEChannelGroup } from '@/server/core/channel-group.js'
import { mergeChannelDefaults } from '@/server/core/merge-channel-defaults.js'

export interface FastifyReplyLike {
  raw: ServerResponse
  hijack?: () => void
}

export interface FastifyRequestLike {
  raw: IncomingMessage
}

/**
 * Attaches an SSE channel to a Node.js HTTP response.
 *
 * Sets the required SSE headers, pipes the channel's `ReadableStream` into
 * the response via `Readable.fromWeb()`, and wires up disconnect detection.
 *
 * Throws an Error synchronously if the required `__restale_cid__` query
 * parameter is missing or invalid.
 *
 * Works with Express (`req, res`) and Fastify (`request, reply`).
 *
 * @param group - Optional `SSEChannelGroup` whose `channelDefaults` are merged into
 *   `options` before creating the channel. Per-channel values always win over defaults.
 */
export function attachSSE<TSignal extends InvalidateSignal = InvalidateSignal>(
  req: IncomingMessage | FastifyRequestLike,
  res: ServerResponse | FastifyReplyLike,
  options: SSEChannelOptions<TSignal>,
  group?: SSEChannelGroup<TSignal>
): SSEChannel<TSignal> {
  if ('hijack' in res && typeof res.hijack === 'function') {
    res.hijack()
  }

  const actualReq = 'raw' in req ? req.raw : req
  const actualRes = 'raw' in res ? res.raw : res

  const rawUrl = actualReq.url || '/'
  const searchIndex = rawUrl.indexOf('?')
  const searchParams = new URLSearchParams(searchIndex !== -1 ? rawUrl.slice(searchIndex) : '')
  const connectionId = extractConnectionId(searchParams)
  const requestedTarget = extractRequestedTarget(searchParams)

  const lastEventId = options.lastEventId ?? extractLastEventId((name) => actualReq.headers[name])

  const baseOptions: SSEChannelOptions<TSignal> = {
    ...options,
    lastEventId,
    connectionId,
    requestedTarget: requestedTarget ?? options.requestedTarget,
  }

  const channelOptions = mergeChannelDefaults(baseOptions, group?.channelDefaults)

  const channel = createSSEChannel<TSignal>(channelOptions)

  const effectiveTarget = channelOptions.target
  const targetHeader = Array.isArray(effectiveTarget)
    ? effectiveTarget.join(', ')
    : (effectiveTarget ?? '')

  // Set SSE headers
  const headers: Record<string, string> = {
    ...SSE_HEADERS,
    [SSE_RESPONSE_HEADERS.RESTALE_TARGET]: targetHeader,
    [SSE_RESPONSE_HEADERS.RESTALE_SUPPORTED]: targetHeader,
  }

  actualRes.writeHead(200, headers)

  // Pipe the ReadableStream into the Node response
  // @ts-expect-error Node typings vs DOM ReadableStream typings compatibility
  const nodeReadable = Readable.fromWeb(channel.stream)
  nodeReadable.pipe(actualRes)

  // Wire up disconnect detection
  actualReq.on('close', () => {
    channel.disconnect()
  })

  return channel
}

