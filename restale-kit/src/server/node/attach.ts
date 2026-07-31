import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { InvalidateSignal, SignalTarget } from '@/types/protocol.js'
import type { SSEChannelOptions, SSEChannel } from '@/server/core/channel.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { buildSSETargetHeaders, extractConnectionId, extractLastEventId, extractRequestedTarget } from '@/server/transport-utils.js'
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
 * @internal
 * **WARNING: INTERNAL ONLY.** Do not invoke directly in application code.
 * Use `SSEChannelGroup.attachNodeResponse(req, res, options)` instead.
 *
 * Attaches an SSE channel to a Node.js HTTP response (or Fastify reply).
 */
export function internal_attachSSE<TSignal extends InvalidateSignal = InvalidateSignal>(
  req: IncomingMessage | FastifyRequestLike,
  res: ServerResponse | FastifyReplyLike,
  options: SSEChannelOptions<TSignal>,
  group?: Pick<SSEChannelGroup<TSignal>, 'channelDefaults'>
): SSEChannel<TSignal> {
  if ('hijack' in res && typeof res.hijack === 'function') {
    res.hijack()
  }

  const actualReq = 'raw' in req ? req.raw : req
  const actualRes = 'raw' in res ? res.raw : res

  const rawUrl = actualReq.url || '/'
  const searchIndex = rawUrl.indexOf('?')
  const searchParams = new URLSearchParams(searchIndex !== -1 ? rawUrl.slice(searchIndex) : '')
  const extractedId = extractConnectionId(searchParams)
  const connectionId = options.connectionId !== undefined ? options.connectionId : extractedId
  const requestedTarget = extractRequestedTarget(searchParams)

  const lastEventId = options.lastEventId ?? extractLastEventId((name) => actualReq.headers[name])

  const baseOptions: SSEChannelOptions<TSignal> = {
    ...options,
    lastEventId,
    connectionId,
    requestedTarget: requestedTarget ?? options.requestedTarget,
  }

  const channelOptions = mergeChannelDefaults<TSignal>(baseOptions, group?.channelDefaults)
  const target = channelOptions.target
  if (target === undefined) {
    throw new Error('[attachNodeResponse] target option is required.')
  }
  const channel = createSSEChannel({ ...channelOptions, target })

  const headers = buildSSETargetHeaders(channelOptions)

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
