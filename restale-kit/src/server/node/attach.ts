import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, PassThrough } from 'node:stream'
import type { SSEChannelTransportOptions, SSEChannel } from '@/server/core/channel.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { buildSSEHeaders, extractLastEventId } from '@/server/transport-utils.js'
import type { SSEChannelGroup } from '@/server/core/channel-group.js'
import { mergeChannelDefaults } from '@/server/core/merge-channel-defaults.js'

export interface FastifyReplyLike {
  raw: ServerResponse
  send?: (payload: unknown) => unknown
  header?: (name: string, value: unknown) => unknown
  hijack?: () => void
}

export interface FastifyRequestLike {
  raw: IncomingMessage
}

export type NodeRequestLike = IncomingMessage | FastifyRequestLike
export type NodeResponseLike = ServerResponse | FastifyReplyLike

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Type guard for Fastify reply objects.
 * Fastify wraps the native ServerResponse in a reply object where `reply.raw` is the ServerResponse.
 */
export function isFastifyReply(res: unknown): res is FastifyReplyLike {
  if (!isRecord(res)) return false
  const raw = res['raw']
  return isRecord(raw)
}

/**
 * Type guard for Fastify request objects.
 */
export function isFastifyRequest(req: unknown): req is FastifyRequestLike {
  if (!isRecord(req)) return false
  const raw = req['raw']
  return isRecord(raw)
}

/**
 * Extracts the underlying IncomingMessage from either a raw Node request or Fastify request.
 */
export function getUnderlyingRequest(req: NodeRequestLike): IncomingMessage {
  if (isFastifyRequest(req)) {
    return req.raw
  }
  return req
}

/**
 * Extracts the underlying ServerResponse from either a raw Node response or Fastify reply.
 */
export function getUnderlyingResponse(res: NodeResponseLike): ServerResponse {
  if (isFastifyReply(res)) {
    return res.raw
  }
  return res
}

/**
 * Streams SSE via Fastify's native `reply.send(stream)` pipeline.
 * Sets headers via `reply.header()`, keeping the stream within Fastify's lifecycle hooks and CORS.
 */
function attachFastifyResponse(
  reply: FastifyReplyLike,
  channel: SSEChannel,
  headers: Record<string, string>
): void {
  if (typeof reply.header === 'function') {
    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, value)
    }
  } else if (reply.raw && typeof reply.raw.setHeader === 'function') {
    for (const [key, value] of Object.entries(headers)) {
      reply.raw.setHeader(key, value)
    }
  }

  // Convert Web ReadableStream to Node.js Readable and prepend the SSE comment preamble ':\n\n'
  // @ts-expect-error Node typings vs DOM ReadableStream typings compatibility
  const nodeReadable = Readable.fromWeb(channel.stream)
  const stream = new PassThrough()
  stream.write(':\n\n')

  nodeReadable.on('error', (err) => {
    console.error('nodeReadable error during attachment ', channel.connectionId, err)
    channel.close()
  })
  stream.on('error', (err) => {
    console.error('stream error during attachment ', channel.connectionId, err)
    channel.close()
  })

  nodeReadable.pipe(stream)

  if (typeof reply.send === 'function') {
    reply.send(stream)
    const originalSend = reply.send.bind(reply)
    reply.send = (payload) => (payload === undefined ? reply : originalSend(payload))
  }
}

/**
 * Streams SSE directly to a Node.js ServerResponse (used by raw Node.js and Express).
 * Uses writeHead(200, headers), flushes headers, and pipes the stream directly to the response socket.
 */
function attachNativeNodeResponse(
  res: ServerResponse,
  channel: SSEChannel,
  headers: Record<string, string>
): void {
  res.writeHead(200, headers)
  res.write(':\n\n')
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders()
  }

  // @ts-expect-error Node typings vs DOM ReadableStream typings compatibility
  const nodeReadable = Readable.fromWeb(channel.stream)
  nodeReadable.on('error', (err) => {
    console.error('nodeReadable error during native attachment', channel.connectionId, err)
    channel.close()
  })
  nodeReadable.pipe(res)
}

/**
 * @internal
 * **WARNING: INTERNAL ONLY.** Do not invoke directly in application code.
 * Use `SSEChannelGroup.attachNodeResponse(req, res, options)` instead.
 *
 * Attaches an SSE channel to a Node.js HTTP response (or Fastify reply).
 */
export function internal_attachSSE(
  req: NodeRequestLike,
  res: NodeResponseLike,
  options: SSEChannelTransportOptions,
  group?: Pick<SSEChannelGroup, 'channelDefaults' | 'eventStore'>
): SSEChannel {
  const actualReq = getUnderlyingRequest(req)
  const actualRes = getUnderlyingResponse(res)
  const lastEventId = options.lastEventId ?? extractLastEventId((name) => actualReq.headers[name])

  const { eventStore: optionEventStore, ...restOptions } = options
  const effectiveEventStore = optionEventStore ?? group?.eventStore
  const baseOptions: SSEChannelTransportOptions = {
    ...restOptions,
    ...(lastEventId !== undefined ? { lastEventId } : {}),
    ...(effectiveEventStore !== undefined ? { eventStore: effectiveEventStore } : {}),
  }

  const channelOptions = mergeChannelDefaults(baseOptions, group?.channelDefaults)
  const channel = createSSEChannel(channelOptions)
  const headers = buildSSEHeaders()

  // Wire up disconnect detection
  if (actualReq && typeof actualReq.on === 'function') {
    actualReq.on('close', () => {
      channel.disconnect()
    })
  }
  if (actualRes && typeof actualRes.on === 'function') {
    actualRes.on('close', () => {
      channel.disconnect()
    })
  }

  if (isFastifyReply(res) && typeof res.send === 'function') {
    attachFastifyResponse(res, channel, headers)
  } else {
    attachNativeNodeResponse(actualRes, channel, headers)
  }

  return channel
}
