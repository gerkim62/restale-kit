import type { IncomingMessage, ServerResponse } from 'node:http'
import type { InvalidateSignal } from '@/types/protocol.js'
import type { SSEChannelOptions, SSEChannel } from '@/server/core/channel.js'
import type { SSEChannelGroup } from '@/server/core/channel-group.js'
import { attachSSE as nodeAttachSSE } from '../node/attach.js'

export interface FastifyReplyLike {
  raw: ServerResponse
  hijack?: () => void
}

export interface FastifyRequestLike {
  raw: IncomingMessage
}

/**
 * Attaches an SSE channel to a Fastify response.
 * Automatically invokes `reply.hijack()` if a Fastify `reply` object is provided.
 *
 * @param group - Optional `SSEChannelGroup` whose `channelDefaults` are merged into
 *   `options` before creating the channel. Per-channel values always win over defaults.
 */
export function attachSSE<TSignal extends InvalidateSignal = InvalidateSignal>(
  req: IncomingMessage | FastifyRequestLike,
  res: ServerResponse | FastifyReplyLike,
  options: SSEChannelOptions,
  group?: SSEChannelGroup<TSignal>
): SSEChannel<TSignal> {
  if ('hijack' in res && typeof res.hijack === 'function') {
    res.hijack()
  }

  const actualReq = 'raw' in req ? req.raw : req
  const actualRes = 'raw' in res ? res.raw : res

  return nodeAttachSSE(actualReq, actualRes, options, group)
}
