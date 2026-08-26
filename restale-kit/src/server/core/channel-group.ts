import {
  isJSONValue,
  type EventStore,
  type JSONValue,
  type RevalidateSignal,
  type Signal,
} from '@/types/protocol'
import { ChannelClosedError, SchemaValidationError } from '@/types/errors'
import type { StandardSchemaV1 } from '@/types/standard-schema'
import { validateStandardSchema } from '@/types/standard-schema'
import type { PubSubAdapter } from '@/pubsub/core/index'
import { createEventStore } from '@/server/core/event-store'
import { type SSEChannel, type SSEChannelOptions, validateSignalPayload } from '@/server/core/channel'
import { internal_toSSEResponse } from '@/server/fetch/response'
import {
  internal_attachSSE,
  type NodeRequestLike,
  type NodeResponseLike,
  getUnderlyingRequest,
  getUnderlyingResponse,
  isFastifyReply,
} from '@/server/node/attach'
import type { ChannelDefaults } from '@/server/core/merge-channel-defaults'
import { PROTOCOL_CONSTANTS } from '@/utils/constants'
import { extractRawId, signToken, verifyToken } from '@/utils/hmac'
import {
  matchesClusterFilter,
  matchesLocalFilter,
  type ClusterFilter,
  type LocalFilter,
} from '@/utils/filter'
import { generateUUID } from '@/utils/id'

export interface ChannelSetupOptions<TMeta = unknown> extends SSEChannelOptions {
  topics?: string[]
  meta?: TMeta
}

export interface InlineDataConnection<TMeta, TClientContext> {
  readonly connectionId: string
  readonly meta: TMeta | undefined
  readonly clientContext: TClientContext | undefined
}

export type InlineDataResolverResult =
  | {
      action: 'inlineData'
      signal: RevalidateSignal
      inlineData: JSONValue
      markStale?: boolean
    }
  | {
      action: 'revalidate'
      signal: RevalidateSignal
    }
  | {
      action: 'skip'
    }

export type InlineDataResolver<TMeta, TClientContext> = (
  connections: ReadonlyArray<InlineDataConnection<TMeta, TClientContext>>,
  payload: JSONValue,
) => Map<string, InlineDataResolverResult> | Promise<Map<string, InlineDataResolverResult>>

interface BaseGroupOptions<TMeta, TClientContext> {
  /**
   * Cryptographic secret used to HMAC-SHA256 sign connection tokens.
   * Required. Must be a non-empty string.
   */
  secret: string

  /**
   * Validates server-side metadata on stream creation.
   * Throws SchemaValidationError on invalid input.
   */
  metaSchema?: StandardSchemaV1<unknown, TMeta>

  /**
   * Validates untrusted client context submitted via POST /sse.
   * Automatically returns HTTP 422 Unprocessable Entity on validation failure.
   */
  clientContextSchema?: StandardSchemaV1<unknown, TClientContext>

  /**
   * Resolves per-connection cache signals and inline payloads during pushInlineData.
   * Required if pushInlineData is called.
   */
  inlineDataResolver?: InlineDataResolver<TMeta, TClientContext>

  /**
   * Hook invoked if the inlineDataResolver omits any active connections.
   */
  onInlineDataResolverError?: (info: { topic?: string; missingConnectionIds: readonly string[] }) => void

  /**
   * Pub/Sub adapter (Redis, Ably, Pusher) for multi-instance distributed deployments.
   * Required to use group.cluster.* methods.
   */
  pubsub?: PubSubAdapter

  /**
   * Custom control topic name for cluster-wide revocations and context sync.
   * @default '__restale_control__'
   */
  controlTopic?: string

  /**
   * Number of invalidation events retained in memory for Last-Event-ID replay on reconnect.
   * @default undefined (Replay disabled unless configured)
   */
  eventBufferCapacity?: number

  /**
   * Custom external or persistent EventStore implementation for event replay.
   */
  eventStore?: EventStore

  /**
   * Default connection settings applied to all channels created through this group.
   */
  channelDefaults?: ChannelDefaults
}

export type SSEChannelGroupOptions<TMeta = undefined, TClientContext = unknown> =
  BaseGroupOptions<TMeta, TClientContext> &
    ([TMeta] extends [undefined]
      ? {
          /**
           * Optional for unauthenticated apps where TMeta is undefined.
           */
          scopeBy?: readonly never[]
        }
      : keyof TMeta & string extends never
      ? {
          /**
           * Optional when TMeta keys cannot be statically resolved.
           */
          scopeBy?: readonly string[]
        }
      : {
          /**
           * Required for authenticated apps. Specify the stable identity keys in TMeta to sign
           * (e.g. ['userId', 'orgId']). Prevents signature mismatches when dynamic session fields shift.
           */
          scopeBy: readonly [keyof TMeta & string, ...(keyof TMeta & string)[]]
        })

type Entry<TMeta, TClientContext> = {
  meta: TMeta | undefined
  clientContext: TClientContext | undefined
  topics: Set<string>
  rawConnectionId: string
}

function isNodeResponseLike(res: unknown): res is NodeResponseLike {
  if (typeof res !== 'object' || res === null) return false
  if (isFastifyReply(res)) return true
  if ('writeHead' in res && typeof res.writeHead === 'function') return true
  if ('send' in res && typeof res.send === 'function') return true
  if (
    'raw' in res &&
    typeof res.raw === 'object' &&
    res.raw !== null &&
    'setHeader' in res.raw &&
    typeof res.raw.setHeader === 'function'
  ) {
    return true
  }
  return false
}

function isFetchRequest(req: unknown): req is Request {
  if (typeof Request !== 'undefined' && req instanceof Request) return true
  if (isPlainRecord(req)) {
    return 'headers' in req && 'method' in req && 'url' in req && (typeof req.json === 'function' || typeof req.text === 'function')
  }
  return false
}

export class SSEChannelGroup<TMeta = undefined, TClientContext = unknown> {
  private readonly channels = new Map<SSEChannel, Entry<TMeta, TClientContext>>()
  private readonly topicChannels = new Map<string, Set<SSEChannel>>()
  private readonly topicUnsubscribers = new Map<string, () => void | Promise<void>>()
  private readonly pendingTopicSubscriptions = new Map<string, Promise<(() => void | Promise<void>) | undefined>>()
  private readonly pendingTopicUnsubscriptions = new Map<string, Promise<void>>()
  private readonly connectionIndex = new Map<string, Set<SSEChannel>>()
  private readonly clientContextRevisions = new Map<string, number>()
  private controlUnsubscribe: (() => void | Promise<void>) | undefined
  readonly eventStore: EventStore | undefined
  readonly channelDefaults: ChannelDefaults | undefined
  readonly controlTopic: string
  readonly secret: string
  readonly scopeBy: readonly string[] | undefined

  constructor(private readonly options: SSEChannelGroupOptions<TMeta, TClientContext>) {
    if (!options || typeof options.secret !== 'string' || !options.secret.trim()) {
      throw new Error('[SSEChannelGroup] secret is required and must be a non-empty string.')
    }
    this.secret = options.secret
    this.scopeBy = 'scopeBy' in options ? options.scopeBy : undefined

    if (this.scopeBy !== undefined) {
      if (!Array.isArray(this.scopeBy) || this.scopeBy.some((k) => typeof k !== 'string' || !k.trim())) {
        throw new Error('[SSEChannelGroup] scopeBy must be an array of non-empty property names.')
      }
    }

    if (
      options.eventBufferCapacity !== undefined &&
      (!Number.isSafeInteger(options.eventBufferCapacity) || options.eventBufferCapacity < 0)
    ) {
      throw new RangeError('[SSEChannelGroup] eventBufferCapacity must be a non-negative safe integer.')
    }

    this.channelDefaults = options.channelDefaults
    this.eventStore =
      options.eventStore ??
      (options.eventBufferCapacity && options.eventBufferCapacity > 0
        ? createEventStore({ capacity: options.eventBufferCapacity })
        : undefined)
    this.controlTopic = options.controlTopic ?? PROTOCOL_CONSTANTS.DEFAULT_CONTROL_TOPIC
    validateTopic(this.controlTopic, 'controlTopic')

    if (options.pubsub) {
      void this.subscribeControl().catch((error: unknown) => {
        console.error('[SSEChannelGroup] Failed to subscribe to control topic:', error)
      })
    }
  }

  /**
   * Single-instance / in-memory operations.
   */
  get local() {
    return {
      size: this.channels.size,

      broadcast: (
        signal: Signal | Signal[],
        filter: LocalFilter<TMeta>,
      ): { sent: number; errors: number } => {
        validateSignalPayload(signal)
        const eventId = this.eventStore?.add(signal).id
        let sent = 0
        let errors = 0
        for (const [channel, entry] of this.channels) {
          if (!matchesLocalFilter(entry.meta, filter)) continue
          try {
            this.deliver(channel, signal, eventId)
            sent++
          } catch (error) {
            errors++
            console.error('[SSEChannelGroup.local.broadcast] Delivery error:', error)
          }
        }
        return { sent, errors }
      },

      revokeWhere: (filter: LocalFilter<TMeta>): { revoked: number } => {
        let revoked = 0
        for (const [channel, entry] of Array.from(this.channels.entries())) {
          if (matchesLocalFilter(entry.meta, filter)) {
            channel.revoke()
            revoked++
          }
        }
        return { revoked }
      },

      revokeByConnectionId: (
        token: string,
        scope?: Record<string, unknown>,
      ): { closed: boolean } => {
        if (!token || typeof token !== 'string' || !token.trim()) {
          throw new Error('[SSEChannelGroup.local.revokeByConnectionId] connectionId must be a non-empty string.')
        }
        const verification = verifyToken(this.secret, token, scope)
        if (!verification.valid) {
          return { closed: false }
        }
        return { closed: this.closeConnection(verification.rawId, token, scope) }
      },

      pushInlineData: async (
        payload: JSONValue,
        filter: LocalFilter<TMeta>,
      ): Promise<void> => {
        if (!isJSONValue(payload)) {
          throw new Error('[SSEChannelGroup.local.pushInlineData] payload must be a valid JSONValue.')
        }
        const resolver = this.options.inlineDataResolver
        if (!resolver) {
          throw new Error('[SSEChannelGroup.local.pushInlineData] inlineDataResolver must be configured.')
        }

        const matchedChannels: SSEChannel[] = []
        for (const [channel, entry] of this.channels) {
          if (matchesLocalFilter(entry.meta, filter)) {
            matchedChannels.push(channel)
          }
        }

        const connections: InlineDataConnection<TMeta, TClientContext>[] = matchedChannels.map((channel) => {
          const entry = this.channels.get(channel)
          return {
            connectionId: channel.connectionId,
            meta: entry?.meta,
            clientContext: entry?.clientContext,
          }
        })

        const resolved = await resolver(connections, payload)
        const missingConnectionIds = connections
          .filter((conn) => !resolved.has(conn.connectionId))
          .map((conn) => conn.connectionId)

        if (missingConnectionIds.length > 0) {
          console.warn(
            `[SSEChannelGroup] inlineDataResolver returned no result for ${String(missingConnectionIds.length)} connection(s). Missing IDs: ${missingConnectionIds.join(', ')}`,
          )
          this.options.onInlineDataResolverError?.({ missingConnectionIds })
        }

        const errors: unknown[] = []
        for (const channel of matchedChannels) {
          const result = resolved.get(channel.connectionId)
          if (!result || result.action === 'skip') continue
          try {
            let signal: Signal
            if (result.action === 'inlineData') {
              signal = {
                key: result.signal.key,
                inlineData: result.inlineData,
                ...(result.markStale ? { markStale: true } : {}),
              }
            } else if (result.action === 'revalidate') {
              signal = result.signal
            } else {
              const invalidResult: unknown = result
              const actionDesc = isPlainRecord(invalidResult) ? String(invalidResult['action']) : String(invalidResult)
              throw new Error(
                `[SSEChannelGroup] Invalid action in inlineDataResolver result for connection "${channel.connectionId}": ${actionDesc}`,
              )
            }
            this.deliver(channel, signal)
          } catch (error) {
            errors.push(error)
          }
        }

        if (errors.length) {
          throw new AggregateError(errors, 'Inline data delivery encountered runtime errors')
        }
      },
    }
  }

  /**
   * Distributed / multi-instance cluster operations via pub/sub broker.
   */
  get cluster() {
    const ensurePubSub = (): PubSubAdapter => {
      if (!this.options.pubsub) {
        throw new Error(
          '[SSEChannelGroup.cluster] PubSubAdapter is not configured on this group. Use group.local.* or configure pubsub.',
        )
      }
      return this.options.pubsub
    }

    return {
      broadcast: async (topic: string, signal: Signal | Signal[]): Promise<void> => {
        const pubsub = ensurePubSub()
        validateTopic(topic, 'topic')
        validateSignalPayload(signal)
        const eventId = this.eventStore?.add(signal).id

        // Deliver locally to current pod connections on this topic
        for (const channel of this.topicChannels.get(topic) ?? []) {
          try {
            this.deliver(channel, signal, eventId)
          } catch (error) {
            console.error('[SSEChannelGroup.cluster.broadcast] Failed local delivery:', error)
          }
        }

        await pubsub.publish(topic, {
          kind: 'signal',
          data: signal,
          ...(eventId ? { id: eventId } : {}),
        })
      },

      pushInlineData: async (topic: string, payload: JSONValue): Promise<void> => {
        const pubsub = ensurePubSub()
        validateTopic(topic, 'topic')
        if (!isJSONValue(payload)) {
          throw new Error('[SSEChannelGroup.cluster.pushInlineData] payload must be a valid JSONValue.')
        }

        // Deliver locally on this pod
        await this.deliverTopicInlineData(topic, payload)

        // Publish to cluster control topic for remote pods
        await pubsub.publish(this.controlTopic, { kind: 'inlineData', topic, payload })
      },

      revokeWhere: async (filter: ClusterFilter<TMeta>): Promise<void> => {
        const pubsub = ensurePubSub()
        // Revoke locally
        for (const [channel, entry] of Array.from(this.channels.entries())) {
          if (matchesClusterFilter(entry.meta, filter)) {
            channel.revoke()
          }
        }

        // Publish to control topic
        const controlData = { type: 'revokeWhere', criteria: filter }
        if (!isJSONValue(controlData)) {
          throw new Error('[SSEChannelGroup] filter must be JSON serializable.')
        }
        await pubsub.publish(this.controlTopic, {
          kind: 'control',
          data: controlData,
        })
      },

      revokeByConnectionId: async (
        token: string,
        scope?: Record<string, unknown>,
      ): Promise<void> => {
        const pubsub = ensurePubSub()
        if (!token || typeof token !== 'string' || !token.trim()) {
          throw new Error('[SSEChannelGroup.cluster.revokeByConnectionId] connectionId must be a non-empty string.')
        }
        const verification = verifyToken(this.secret, token, scope)
        if (!verification.valid) {
          return
        }

        // Close on current pod if present
        this.closeConnection(verification.rawId, token, scope)

        const controlData = {
          type: 'revokeByConnectionId',
          connectionId: verification.rawId,
          ...(scope ? { scope } : {}),
        }
        if (!isJSONValue(controlData)) {
          throw new Error('[SSEChannelGroup] scope must be JSON serializable.')
        }

        // Broadcast to cluster
        await pubsub.publish(this.controlTopic, {
          kind: 'control',
          data: controlData,
        })
      },
    }
  }

  /**
   * Universal HTTP route handler for all frameworks (Express, Fastify, Next.js, Hono, Bun, Deno, etc.)
   */
  handle(
    req: NodeRequestLike,
    res: NodeResponseLike,
    options?: ChannelSetupOptions<TMeta>,
  ): Promise<void>
  handle(
    request: Request,
    options?: ChannelSetupOptions<TMeta>,
  ): Promise<Response>
  async handle(
    reqOrRequest: NodeRequestLike | Request,
    resOrOptions?: NodeResponseLike | ChannelSetupOptions<TMeta>,
    maybeOptions?: ChannelSetupOptions<TMeta>,
  ): Promise<Response | void> {
    if (isNodeResponseLike(resOrOptions)) {
      if (!isFetchRequest(reqOrRequest)) {
        return this.handleNode(
          reqOrRequest,
          resOrOptions,
          maybeOptions,
        )
      }
    }

    if (isFetchRequest(reqOrRequest)) {
      const options = isNodeResponseLike(resOrOptions) ? maybeOptions : resOrOptions
      return this.handleFetch(reqOrRequest, options)
    }

    throw new TypeError('[SSEChannelGroup.handle] Unsupported request/response arguments.')
  }

  private async handleNode(
    req: NodeRequestLike,
    res: NodeResponseLike,
    options?: ChannelSetupOptions<TMeta>,
  ): Promise<void> {
    const rawReq = getUnderlyingRequest(req)
    const method = (rawReq.method ?? 'GET').toUpperCase()

    // 1. OPTIONS Preflight
    if (method === 'OPTIONS') {
      const headers: Record<string, string> = {
        Allow: 'GET, POST, OPTIONS',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID, Cache-Control',
        'Access-Control-Max-Age': '86400',
      }
      if (isFastifyReply(res) && typeof res.send === 'function') {
        for (const [k, v] of Object.entries(headers)) {
          res.header?.(k, v)
        }
        res.raw.writeHead(204, headers)
        res.raw.end()
        return
      }
      const rawRes = getUnderlyingResponse(res)
      rawRes.writeHead(204, headers)
      rawRes.end()
      return
    }

    // 2. GET (SSE Stream)
    if (method === 'GET') {
      const { meta: rawMeta, topics, ...channelOptions } = options ?? {}
      this.validateTopics(topics)
      const meta = this.validateMeta(rawMeta)
      const scopedMeta = extractScopedMeta(meta, this.scopeBy)
      const rawUUID = generateUUID()
      const signedToken = signToken(this.secret, rawUUID, scopedMeta)

      const channel = internal_attachSSE(
        req,
        res,
        { ...channelOptions, connectionId: signedToken },
        this,
      )
      this.register(channel, meta, { rawId: rawUUID, topics })
      return
    }

    // 3. POST (Context Sync)
    if (method === 'POST') {
      const body = 'body' in req ? req.body : undefined
      if (body === undefined) {
        const errorJson = JSON.stringify({
          error:
            '[restale] Request body is missing on POST /sse. Ensure JSON body-parser middleware (e.g. express.json()) is mounted before group.handle().',
        })
        const rawRes = getUnderlyingResponse(res)
        rawRes.writeHead(500, { 'Content-Type': 'application/json' })
        rawRes.end(errorJson)
        return
      }

      if (
        !isPlainRecord(body) ||
        body.purpose !== 'CLIENT_CONTEXT' ||
        typeof body.connectionId !== 'string' ||
        !body.connectionId.trim()
      ) {
        const rawRes = getUnderlyingResponse(res)
        rawRes.writeHead(400, { 'Content-Type': 'application/json' })
        rawRes.end(
          JSON.stringify({
            error:
              "Invalid POST payload. Expected purpose: 'CLIENT_CONTEXT' and a valid connectionId.",
          }),
        )
        return
      }

      if (
        body.revision !== undefined &&
        (typeof body.revision !== 'number' ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 0)
      ) {
        const rawRes = getUnderlyingResponse(res)
        rawRes.writeHead(400, { 'Content-Type': 'application/json' })
        rawRes.end(JSON.stringify({ error: 'revision must be a non-negative safe integer.' }))
        return
      }

      // HMAC Verification
      const meta = this.validateMeta(options?.meta)
      const scopedMeta = extractScopedMeta(meta, this.scopeBy)
      const verification = verifyToken(this.secret, body.connectionId, scopedMeta)
      if (!verification.valid) {
        const rawRes = getUnderlyingResponse(res)
        rawRes.writeHead(403, { 'Content-Type': 'application/json' })
        rawRes.end(
          JSON.stringify({
            error: 'Forbidden: Connection token HMAC signature verification failed.',
          }),
        )
        return
      }

      // Client context schema validation
      let validatedContext: TClientContext
      try {
        validatedContext = this.validateClientContext(body.clientContext)
      } catch (error) {
        const rawRes = getUnderlyingResponse(res)
        rawRes.writeHead(422, { 'Content-Type': 'application/json' })
        const message = error instanceof SchemaValidationError ? error.message : 'Validation failed'
        rawRes.end(JSON.stringify({ error: message, details: error instanceof SchemaValidationError ? error.issues : undefined }))
        return
      }

      // Update locally
      this.updateLocalClientContext(
        verification.rawId,
        body.connectionId,
        validatedContext,
        scopedMeta,
        body.revision,
      )

      // Sync across cluster
      if (this.options.pubsub) {
        if (!isJSONValue(validatedContext)) {
          const rawRes = getUnderlyingResponse(res)
          rawRes.writeHead(500, { 'Content-Type': 'application/json' })
          rawRes.end(JSON.stringify({ error: 'clientContext must be serializable JSON with pubsub.' }))
          return
        }
        const controlData = {
          type: 'updateClientContext',
          connectionId: verification.rawId,
          clientContext: validatedContext,
          ...(scopedMeta ? { scope: scopedMeta } : {}),
          ...(body.revision !== undefined ? { revision: body.revision } : {}),
        }
        if (!isJSONValue(controlData)) {
          const rawRes = getUnderlyingResponse(res)
          rawRes.writeHead(500, { 'Content-Type': 'application/json' })
          rawRes.end(JSON.stringify({ error: 'Failed to serialize control message payload.' }))
          return
        }
        await this.options.pubsub.publish(this.controlTopic, {
          kind: 'control',
          data: controlData,
        })
      }

      const rawRes = getUnderlyingResponse(res)
      rawRes.writeHead(200, { 'Content-Type': 'application/json' })
      rawRes.end(JSON.stringify({ ok: true }))
      return
    }

    // 4. Any other method
    const rawRes = getUnderlyingResponse(res)
    rawRes.writeHead(405, { Allow: 'GET, POST, OPTIONS', 'Content-Type': 'application/json' })
    rawRes.end(JSON.stringify({ error: 'Method Not Allowed' }))
  }

  private async handleFetch(
    request: Request,
    options?: ChannelSetupOptions<TMeta>,
  ): Promise<Response> {
    const method = request.method.toUpperCase()

    // 1. OPTIONS Preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          Allow: 'GET, POST, OPTIONS',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID, Cache-Control',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    // 2. GET (SSE Stream)
    if (method === 'GET') {
      const { meta: rawMeta, topics, ...channelOptions } = options ?? {}
      this.validateTopics(topics)
      const meta = this.validateMeta(rawMeta)
      const scopedMeta = extractScopedMeta(meta, this.scopeBy)
      const rawUUID = generateUUID()
      const signedToken = signToken(this.secret, rawUUID, scopedMeta)

      const result = internal_toSSEResponse(
        request,
        { ...channelOptions, connectionId: signedToken },
        this,
      )
      this.register(result.channel, meta, { rawId: rawUUID, topics })
      return result.response
    }

    // 3. POST (Context Sync)
    if (method === 'POST') {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return Response.json({ error: 'Malformed JSON payload.' }, { status: 400 })
      }

      if (
        !isPlainRecord(body) ||
        body.purpose !== 'CLIENT_CONTEXT' ||
        typeof body.connectionId !== 'string' ||
        !body.connectionId.trim()
      ) {
        return Response.json(
          {
            error:
              "Invalid POST payload. Expected purpose: 'CLIENT_CONTEXT' and a valid connectionId.",
          },
          { status: 400 },
        )
      }

      if (
        body.revision !== undefined &&
        (typeof body.revision !== 'number' ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 0)
      ) {
        return Response.json({ error: 'revision must be a non-negative safe integer.' }, { status: 400 })
      }

      // HMAC Verification
      const meta = this.validateMeta(options?.meta)
      const scopedMeta = extractScopedMeta(meta, this.scopeBy)
      const verification = verifyToken(this.secret, body.connectionId, scopedMeta)
      if (!verification.valid) {
        return Response.json(
          { error: 'Forbidden: Connection token HMAC signature verification failed.' },
          { status: 403 },
        )
      }

      // Client context schema validation
      let validatedContext: TClientContext
      try {
        validatedContext = this.validateClientContext(body.clientContext)
      } catch (error) {
        const message = error instanceof SchemaValidationError ? error.message : 'Validation failed'
        return Response.json(
          { error: message, details: error instanceof SchemaValidationError ? error.issues : undefined },
          { status: 422 },
        )
      }

      // Update locally
      this.updateLocalClientContext(
        verification.rawId,
        body.connectionId,
        validatedContext,
        scopedMeta,
        body.revision,
      )

      // Sync across cluster
      if (this.options.pubsub) {
        if (!isJSONValue(validatedContext)) {
          return Response.json({ error: 'clientContext must be serializable JSON with pubsub.' }, { status: 500 })
        }
        const controlData = {
          type: 'updateClientContext',
          connectionId: verification.rawId,
          clientContext: validatedContext,
          ...(scopedMeta ? { scope: scopedMeta } : {}),
          ...(body.revision !== undefined ? { revision: body.revision } : {}),
        }
        if (!isJSONValue(controlData)) {
          return Response.json({ error: 'Failed to serialize control message payload.' }, { status: 500 })
        }
        await this.options.pubsub.publish(this.controlTopic, {
          kind: 'control',
          data: controlData,
        })
      }

      return Response.json({ ok: true }, { status: 200 })
    }

    // 4. Any other method
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: {
        Allow: 'GET, POST, OPTIONS',
        'Content-Type': 'application/json',
      },
    })
  }

  /**
   * Registers a channel with this group, assigning metadata and subscribing to initial topics.
   */
  register(
    channel: SSEChannel,
    meta?: TMeta,
    options?: { rawId?: string | undefined; topics?: string[] | undefined },
  ): void {
    const rawId = options?.rawId ?? extractRawId(channel.connectionId)
    const topics = options?.topics

    this.validateTopics(topics)
    const existing = this.channels.get(channel)
    if (existing) this.detachTopics(channel, existing.topics)

    const entry: Entry<TMeta, TClientContext> = {
      meta: this.validateMeta(meta),
      clientContext: existing?.clientContext,
      topics: new Set(topics ?? []),
      rawConnectionId: rawId,
    }
    this.channels.set(channel, entry)

    // Index by both raw UUID and full connection ID
    this.indexChannel(rawId, channel)
    if (channel.connectionId && channel.connectionId !== rawId) {
      this.indexChannel(channel.connectionId, channel)
    }

    for (const topic of entry.topics) this.attachTopic(channel, topic)
    if (!existing) {
      channel.onClose(() => {
        this.deregister(channel)
      })
    }
  }

  deregister(channel: SSEChannel): void {
    const entry = this.channels.get(channel)
    if (!entry) return
    this.channels.delete(channel)
    this.detachTopics(channel, entry.topics)

    this.unindexChannel(entry.rawConnectionId, channel)
    this.unindexChannel(channel.connectionId, channel)
  }

  getClientContext(connectionId: string): TClientContext | undefined {
    const rawId = extractRawId(connectionId)
    const channels = this.connectionIndex.get(rawId) ?? this.connectionIndex.get(connectionId)
    let result: TClientContext | undefined
    for (const channel of channels ?? []) {
      const value = this.channels.get(channel)?.clientContext
      if (value !== undefined) result = value
    }
    return result
  }

  async dispose(): Promise<void> {
    for (const [channel] of this.channels) {
      try {
        channel.close()
      } catch {
        /* best effort */
      }
    }
    if (this.controlUnsubscribe) {
      try {
        await this.controlUnsubscribe()
      } catch (error) {
        console.error('[SSEChannelGroup] Failed to unsubscribe control subscriber during dispose:', error)
      } finally {
        this.controlUnsubscribe = undefined
      }
    }
    if (this.pendingTopicSubscriptions.size > 0) {
      await Promise.allSettled(Array.from(this.pendingTopicSubscriptions.values()))
    }
    if (this.pendingTopicUnsubscriptions.size > 0) {
      await Promise.allSettled(Array.from(this.pendingTopicUnsubscriptions.values()))
    }
    for (const unsubscribe of this.topicUnsubscribers.values()) {
      try {
        await unsubscribe()
      } catch (error) {
        console.error('[SSEChannelGroup] Failed to unsubscribe during dispose:', error)
      }
    }
    this.topicUnsubscribers.clear()
    this.pendingTopicSubscriptions.clear()
    this.pendingTopicUnsubscriptions.clear()
    this.channels.clear()
    this.topicChannels.clear()
    this.connectionIndex.clear()
    this.clientContextRevisions.clear()
  }

  private indexChannel(key: string, channel: SSEChannel): void {
    let set = this.connectionIndex.get(key)
    if (!set) this.connectionIndex.set(key, (set = new Set()))
    set.add(channel)
  }

  private unindexChannel(key: string, channel: SSEChannel): void {
    const set = this.connectionIndex.get(key)
    set?.delete(channel)
    if (set?.size === 0) {
      this.connectionIndex.delete(key)
      this.clientContextRevisions.delete(key)
    }
  }

  private deliver(channel: SSEChannel, signal: Signal | Signal[], eventId?: string): void {
    try {
      channel.invalidate(signal, eventId)
    } catch (error) {
      if (error instanceof ChannelClosedError) this.deregister(channel)
      else throw error
    }
  }

  private validateMeta(meta: TMeta | undefined): TMeta | undefined {
    return this.options.metaSchema ? validateStandardSchema(meta, this.options.metaSchema) : meta
  }

  private isClientContext(_value: unknown): _value is TClientContext {
    return true
  }

  private validateClientContext(context: unknown): TClientContext {
    if (this.options.clientContextSchema) {
      return validateStandardSchema(context, this.options.clientContextSchema)
    }
    if (this.isClientContext(context)) {
      return context
    }
    throw new TypeError('[SSEChannelGroup] Invalid clientContext')
  }

  private validateTopics(topics: string[] | undefined): void {
    for (const topic of topics ?? []) validateTopic(topic, 'topics entry')
  }

  private attachTopic(channel: SSEChannel, topic: string): void {
    let channels = this.topicChannels.get(topic)
    if (!channels) this.topicChannels.set(topic, (channels = new Set()))
    channels.add(channel)
    const pubsub = this.options.pubsub
    if (!pubsub) return

    if (this.topicUnsubscribers.has(topic) || this.pendingTopicSubscriptions.has(topic)) {
      return
    }

    const startSubscription = async () => {
      const pendingUnsub = this.pendingTopicUnsubscriptions.get(topic)
      if (pendingUnsub) {
        await pendingUnsub
      }

      if (!this.topicChannels.has(topic)) {
        return undefined
      }

      return pubsub.subscribe(topic, (message) => {
        if (message.kind !== 'signal') return
        const eventId = this.eventStore?.add(message.data, message.id).id ?? message.id
        for (const subscribed of this.topicChannels.get(topic) ?? []) {
          try {
            this.deliver(subscribed, message.data, eventId)
          } catch (error) {
            console.error('[SSEChannelGroup] Failed to deliver pubsub signal to channel:', error)
          }
        }
      })
    }

    const subscriptionPromise = startSubscription()
    this.pendingTopicSubscriptions.set(topic, subscriptionPromise)

    subscriptionPromise
      .then((unsubscribe) => {
        if (unsubscribe) {
          if (this.topicChannels.get(topic)?.size === 0) {
            void this.executeTopicUnsubscribe(topic, unsubscribe)
          } else {
            this.topicUnsubscribers.set(topic, unsubscribe)
          }
        }
        return unsubscribe
      })
      .catch((error: unknown) => {
        console.error(`[SSEChannelGroup] Failed to subscribe to pubsub topic "${topic}":`, error)
      })
      .finally(() => {
        if (this.pendingTopicSubscriptions.get(topic) === subscriptionPromise) {
          this.pendingTopicSubscriptions.delete(topic)
        }
      })
  }

  private detachTopics(channel: SSEChannel, topics: Iterable<string>): void {
    for (const topic of topics) {
      const channels = this.topicChannels.get(topic)
      channels?.delete(channel)
      if (channels?.size === 0) {
        this.topicChannels.delete(topic)
        const unsubscribe = this.topicUnsubscribers.get(topic)
        this.topicUnsubscribers.delete(topic)
        if (unsubscribe) {
          void this.executeTopicUnsubscribe(topic, unsubscribe)
        }
      }
    }
  }

  private executeTopicUnsubscribe(topic: string, unsubscribe: () => void | Promise<void>): Promise<void> {
    const unsubscriptionPromise = (async () => {
      try {
        await unsubscribe()
      } catch (error: unknown) {
        console.error(`[SSEChannelGroup] Error unsubscribing from topic "${topic}":`, error)
      }
    })()

    this.pendingTopicUnsubscriptions.set(topic, unsubscriptionPromise)

    void unsubscriptionPromise.finally(() => {
      if (this.pendingTopicUnsubscriptions.get(topic) === unsubscriptionPromise) {
        this.pendingTopicUnsubscriptions.delete(topic)
      }
    })

    return unsubscriptionPromise
  }

  private async subscribeControl(): Promise<void> {
    if (!this.options.pubsub) return
    try {
      this.controlUnsubscribe = await this.options.pubsub.subscribe(this.controlTopic, (message) => {
        try {
          if (message.kind === 'inlineData') {
            void this.deliverTopicInlineData(message.topic, message.payload).catch((error: unknown) => {
              console.error('[SSEChannelGroup] Failed to deliver inline data from pubsub:', error)
            })
            return
          }
          if (message.kind !== 'control' || !isPlainRecord(message.data) || typeof message.data.type !== 'string') return
          if (message.data.type === 'revokeWhere' && 'criteria' in message.data) {
            const criteria = message.data.criteria
            if (criteria === true || isPlainRecord(criteria)) {
              for (const [channel, entry] of this.channels) {
                if (matchesClusterFilter(entry.meta, criteria)) channel.revoke()
              }
            }
          }
          if (message.data.type === 'revokeByConnectionId' && typeof message.data.connectionId === 'string') {
            const rawId = message.data.connectionId
            const scope = isPlainRecord(message.data.scope) ? message.data.scope : undefined
            this.closeConnection(rawId, rawId, scope)
          }
          if (
            message.data.type === 'updateClientContext' &&
            typeof message.data.connectionId === 'string' &&
            'clientContext' in message.data
          ) {
            if (
              'revision' in message.data &&
              (typeof message.data.revision !== 'number' ||
                !Number.isSafeInteger(message.data.revision) ||
                message.data.revision < 0)
            ) {
              return
            }
            const raw = message.data.clientContext
            if (this.isClientContext(raw)) {
              const rawId = message.data.connectionId
              const scope = isPlainRecord(message.data.scope) ? message.data.scope : undefined
              const revision = typeof message.data.revision === 'number' ? message.data.revision : undefined
              const context = this.validateClientContext(raw)
              this.updateLocalClientContext(rawId, rawId, context, scope, revision)
            }
          }
        } catch (error) {
          console.error('[SSEChannelGroup] Error processing pubsub control message:', error)
        }
      })
    } catch (error) {
      console.error(`[SSEChannelGroup] Failed to subscribe to pubsub control topic "${this.controlTopic}":`, error)
    }
  }

  private closeConnection(rawId: string, fullId?: string, scope?: Record<string, unknown>): boolean {
    let closed = false
    const channels = new Set<SSEChannel>()
    for (const ch of this.connectionIndex.get(rawId) ?? []) channels.add(ch)
    if (fullId) {
      for (const ch of this.connectionIndex.get(fullId) ?? []) channels.add(ch)
    }

    for (const channel of channels) {
      const entry = this.channels.get(channel)
      if (!entry) continue
      if (scope && !matchesClusterFilter(entry.meta, scope)) continue
      channel.revoke()
      closed = true
    }
    return closed
  }

  private updateLocalClientContext(
    rawId: string,
    fullId: string,
    context: TClientContext,
    scope?: Record<string, unknown>,
    revision?: number,
  ): boolean {
    const latestRevision = this.clientContextRevisions.get(rawId)
    if (revision !== undefined && latestRevision !== undefined && revision <= latestRevision) {
      return false
    }

    let updated = false
    const channels = new Set<SSEChannel>()
    for (const ch of this.connectionIndex.get(rawId) ?? []) channels.add(ch)
    for (const ch of this.connectionIndex.get(fullId) ?? []) channels.add(ch)

    for (const channel of channels) {
      const entry = this.channels.get(channel)
      if (!entry) continue
      if (scope && !matchesClusterFilter(entry.meta, scope)) continue
      entry.clientContext = context
      updated = true
    }

    if (updated && revision !== undefined) {
      this.clientContextRevisions.set(rawId, revision)
    }
    return updated
  }

  private async deliverTopicInlineData(topic: string, payload: JSONValue): Promise<void> {
    const resolver = this.options.inlineDataResolver
    if (!resolver) throw new Error('[SSEChannelGroup.cluster.pushInlineData] inlineDataResolver must be configured.')
    const channels = Array.from(this.topicChannels.get(topic) ?? [])
    const connections: InlineDataConnection<TMeta, TClientContext>[] = channels.map((channel) => {
      const entry = this.channels.get(channel)
      return {
        connectionId: channel.connectionId,
        meta: entry?.meta,
        clientContext: entry?.clientContext,
      }
    })

    const resolved = await resolver(connections, payload)
    const missingConnectionIds = connections
      .filter((conn) => !resolved.has(conn.connectionId))
      .map((conn) => conn.connectionId)

    if (missingConnectionIds.length > 0) {
      console.warn(
        `[SSEChannelGroup] inlineDataResolver returned no result for ${String(missingConnectionIds.length)} connection(s) on topic "${topic}". Missing IDs: ${missingConnectionIds.join(', ')}`,
      )
      this.options.onInlineDataResolverError?.({ topic, missingConnectionIds })
    }

    const errors: unknown[] = []
    for (const channel of channels) {
      const result = resolved.get(channel.connectionId)
      if (!result || result.action === 'skip') continue
      try {
        let signal: Signal
        if (result.action === 'inlineData') {
          signal = {
            key: result.signal.key,
            inlineData: result.inlineData,
            ...(result.markStale ? { markStale: true } : {}),
          }
        } else if (result.action === 'revalidate') {
          signal = result.signal
        } else {
          const invalidResult: unknown = result
          const actionDesc = isPlainRecord(invalidResult) ? String(invalidResult['action']) : String(invalidResult)
          throw new Error(
            `[SSEChannelGroup] Invalid action in inlineDataResolver result for connection "${channel.connectionId}": ${actionDesc}`,
          )
        }
        this.deliver(channel, signal)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Inline data delivery encountered runtime errors')
  }
}

function validateTopic(topic: string, label: string): void {
  if (typeof topic !== 'string' || topic.replace(/(?:\s|\u200B|\u200C|\u200D|\uFEFF)/gu, '') === '') {
    throw new Error(`[SSEChannelGroup] ${label} must be a non-empty, non-whitespace string.`)
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractScopedMeta(
  meta: unknown,
  scopeBy?: readonly string[],
): Record<string, unknown> | undefined {
  if (!isPlainRecord(meta) || !scopeBy || scopeBy.length === 0) {
    return undefined
  }
  const result: Record<string, unknown> = {}
  for (const key of scopeBy) {
    if (Object.hasOwn(meta, key) && meta[key] !== undefined) {
      result[key] = meta[key]
    }
  }
  return result
}
