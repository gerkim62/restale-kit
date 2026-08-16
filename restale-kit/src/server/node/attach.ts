import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { SSEChannelTransportOptions, SSEChannel } from '@/server/core/channel.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { buildSSEHeaders, extractConnectionId, extractLastEventId } from '@/server/transport-utils.js'
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
export function internal_attachSSE(
  req: IncomingMessage | FastifyRequestLike,
  res: ServerResponse | FastifyReplyLike,
  options: SSEChannelTransportOptions,
  group?: Pick<SSEChannelGroup, 'channelDefaults' | 'eventStore'>
): SSEChannel {
  if ('hijack' in res && typeof res.hijack === 'function') {
    res.hijack()
  }

  const actualReq = 'raw' in req ? req.raw : req
  const actualRes = 'raw' in res ? res.raw : res

  const rawUrl = actualReq.url || '/'
  const searchIndex = rawUrl.indexOf('?')
  const searchParams = new URLSearchParams(searchIndex !== -1 ? rawUrl.slice(searchIndex) : '')
  const connectionId =
    options.connectionId !== undefined
      ? options.connectionId
      : extractConnectionId(searchParams)
  const lastEventId = options.lastEventId ?? extractLastEventId((name) => actualReq.headers[name])

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

  actualRes.writeHead(200, headers)
  actualRes.write(':\n\n')
  if (typeof actualRes.flushHeaders === 'function') {
    actualRes.flushHeaders()
  }

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
