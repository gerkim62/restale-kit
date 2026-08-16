import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  isJSONValue,
  isJSONValueArray,
  type EventStore,
  type JSONValue,
  type RevalidateSignal,
  type UniversalSignal,
} from '@/types/protocol.js'
import { ChannelClosedError } from '@/types/errors.js'
import type { StandardSchemaV1 } from '@/types/standard-schema.js'
import { validateStandardSchema } from '@/types/standard-schema.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import { createEventStore } from '@/server/core/event-store.js'
import { type SSEChannel, type SSEChannelOptions, validateSignalPayload } from '@/server/core/channel.js'
import { internal_toSSEResponse } from '@/server/fetch/response.js'
import { internal_attachSSE, type FastifyReplyLike, type FastifyRequestLike } from '@/server/node/attach.js'
import type { ChannelDefaults } from '@/server/core/merge-channel-defaults.js'
import { PROTOCOL_CONSTANTS } from '@/utils/constants.js'

export type ChannelSetupOptions<TMeta = unknown> = SSEChannelOptions & {
  topics?: string[]
  meta?: TMeta
}

export interface InlineDataConnection<TMeta, TClientContext> {
  readonly connectionId: string
  readonly meta: TMeta | undefined
  readonly clientContext: TClientContext | undefined
}

/**
 * The resolver returns the signal for each connection. Inline data is deliberately
 * kept separate to preserve the client-context API; it is converted to a universal
 * InlineDataSignal immediately before delivery.
 */
export interface InlineDataResult {
  signal: RevalidateSignal
  inlineData?: JSONValue
  markStale?: boolean
}

export type ResolveInlineData<TMeta, TClientContext> = (
  connections: ReadonlyArray<InlineDataConnection<TMeta, TClientContext>>,
  payload: JSONValue,
) => Map<string, InlineDataResult> | Promise<Map<string, InlineDataResult>>

export interface SSEChannelGroupOptions<TMeta = unknown, TClientContext = unknown> {
  metaSchema?: StandardSchemaV1<unknown, TMeta>
  clientContextSchema?: StandardSchemaV1<unknown, TClientContext>
  resolveInlineData?: ResolveInlineData<TMeta, TClientContext>
  onInlineDataResolverError?: (info: { topic: string; missingConnectionIds: readonly string[] }) => void
  pubsub?: PubSubAdapter
  eventStore?: EventStore
  eventBufferCapacity?: number
  controlTopic?: string
  channelDefaults?: ChannelDefaults
}

type Entry<TMeta, TClientContext> = {
  meta: TMeta | undefined
  clientContext: TClientContext | undefined
  topics: Set<string>
}

export class SSEChannelGroup<TMeta = unknown, TClientContext = unknown> {
  private readonly channels = new Map<SSEChannel, Entry<TMeta, TClientContext>>()
  private readonly topicChannels = new Map<string, Set<SSEChannel>>()
  private readonly topicUnsubscribers = new Map<string, () => void | Promise<void>>()
  private readonly connectionIndex = new Map<string, Set<SSEChannel>>()
  private readonly clientContextRevisions = new Map<string, number>()
  private controlUnsubscribe: (() => void | Promise<void>) | undefined
  readonly eventStore: EventStore | undefined
  readonly channelDefaults: ChannelDefaults | undefined
  readonly controlTopic: string

  constructor(private readonly options: SSEChannelGroupOptions<TMeta, TClientContext> = {}) {
    this.channelDefaults = options.channelDefaults
    this.eventStore = options.eventStore ?? (options.eventBufferCapacity && options.eventBufferCapacity > 0
      ? createEventStore({ capacity: options.eventBufferCapacity })
      : undefined)
    this.controlTopic = options.controlTopic ?? PROTOCOL_CONSTANTS.DEFAULT_CONTROL_TOPIC
    validateTopic(this.controlTopic, 'controlTopic')
    if (options.eventBufferCapacity !== undefined &&
      (!Number.isSafeInteger(options.eventBufferCapacity) || options.eventBufferCapacity < 0)) {
      throw new RangeError('[SSEChannelGroup] eventBufferCapacity must be a non-negative safe integer.')
    }
    if (options.pubsub) void this.subscribeControl()
  }

  get size(): number { return this.channels.size }

  createFetchResponse(
    request: Request,
    options: ChannelSetupOptions<TMeta> = {},
  ): { response: Response; channel: SSEChannel } {
    const { meta: rawMeta, topics, ...channelOptions } = options
    this.validateTopics(topics)
    const meta = this.validateMeta(rawMeta)
    const result = internal_toSSEResponse(request, channelOptions, this)
    this.register(result.channel, meta, topics === undefined ? undefined : { topics })
    return result
  }

  attachNodeResponse(
    req: IncomingMessage | FastifyRequestLike,
    res: ServerResponse | FastifyReplyLike,
    options: ChannelSetupOptions<TMeta> = {},
  ): { channel: SSEChannel } {
    const { meta: rawMeta, topics, ...channelOptions } = options
    this.validateTopics(topics)
    const meta = this.validateMeta(rawMeta)
    const channel = internal_attachSSE(req, res, channelOptions, this)
    this.register(channel, meta, topics === undefined ? undefined : { topics })
    return { channel }
  }

  register(channel: SSEChannel, meta?: TMeta, registrationOptions?: { topics?: string[] }): void {
    this.validateTopics(registrationOptions?.topics)
    const existing = this.channels.get(channel)
    if (existing) this.detachTopics(channel, existing.topics)
    const entry: Entry<TMeta, TClientContext> = {
      meta: this.validateMeta(meta),
      clientContext: existing?.clientContext,
      topics: new Set(registrationOptions?.topics ?? []),
    }
    this.channels.set(channel, entry)
    if (channel.connectionId) {
      let set = this.connectionIndex.get(channel.connectionId)
      if (!set) this.connectionIndex.set(channel.connectionId, set = new Set())
      set.add(channel)
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
    const indexed = this.connectionIndex.get(channel.connectionId)
    indexed?.delete(channel)
    if (indexed?.size === 0) {
      this.connectionIndex.delete(channel.connectionId)
      this.clientContextRevisions.delete(channel.connectionId)
    }
  }

  broadcast(signal: UniversalSignal | UniversalSignal[], predicate: (meta: TMeta | undefined) => boolean = () => true): void {
    this.broadcastRaw(signal, predicate)
  }

  broadcastToAll(signal: UniversalSignal | UniversalSignal[]): void {
    this.broadcastRaw(signal, () => true)
  }

  broadcastByKey(signal: RevalidateSignal): void {
    this.broadcastRaw(signal, (meta) => isMetaMatchedByKey(meta, signal.key, signal.exact === true))
  }

  async publish(topic: string, signal: UniversalSignal | UniversalSignal[]): Promise<void> {
    validateTopic(topic, 'topic')
    validateSignalPayload(signal)
    const eventId = this.eventStore?.add(signal).id
    const errors: unknown[] = []
    for (const channel of this.topicChannels.get(topic) ?? []) {
      try {
        this.deliver(channel, signal, eventId)
      } catch (error) {
        errors.push(error)
      }
    }
    await this.options.pubsub?.publish(topic, { kind: 'signal', data: signal, ...(eventId ? { id: eventId } : {}) })
    if (errors.length) throw new AggregateError(errors, 'Publish encountered runtime errors during local channel delivery')
  }

  async pushInlineData(topic: string, payload: JSONValue): Promise<void> {
    validateTopic(topic, 'topic')
    if (!isJSONValue(payload)) throw new Error('[SSEChannelGroup.pushInlineData] payload must be a valid JSONValue.')
    await this.deliverInlineData(topic, payload)
    await this.options.pubsub?.publish(this.controlTopic, { kind: 'inlineData', topic, payload })
  }

  async revokeWhere(criteria: JSONValue): Promise<{ localClosed: number }> {
    if (!isJSONValue(criteria)) throw new Error('[SSEChannelGroup.revokeWhere] criteria must be a valid JSONValue.')
    let localClosed = 0
    for (const [channel, entry] of this.channels) {
      if (matchesCriteria(channel.connectionId, entry.meta, criteria)) {
        channel.revoke()
        localClosed++
      }
    }
    await this.options.pubsub?.publish(this.controlTopic, { kind: 'control', data: { type: 'revokeWhere', criteria } })
    return { localClosed }
  }

  async revokeByConnectionId(
    connectionId: string,
    scope?: Record<string, JSONValue | undefined>,
  ): Promise<{ closed: boolean }> {
    if (!connectionId.trim()) throw new Error('[SSEChannelGroup.revokeByConnectionId] connectionId must be a non-empty string.')
    const normalisedScope = normalizeScope(scope)
    const closed = this.closeConnection(connectionId, normalisedScope)
    await this.options.pubsub?.publish(this.controlTopic, {
      kind: 'control', data: { type: 'revokeByConnectionId', connectionId, ...(normalisedScope ? { scope: normalisedScope } : {}) },
    })
    return { closed }
  }

  async updateClientContext(
    connectionId: string,
    clientContext: TClientContext,
    updateOptions?: { scope?: Record<string, JSONValue | undefined>; revision?: number },
  ): Promise<{ updated: boolean }> {
    if (!connectionId.trim()) throw new Error('[SSEChannelGroup.updateClientContext] connectionId must be a non-empty string.')
    const context = this.options.clientContextSchema
      ? validateStandardSchema(clientContext, this.options.clientContextSchema)
      : clientContext
    const scope = normalizeScope(updateOptions?.scope)
    const revision = updateOptions?.revision
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) {
      throw new Error('[SSEChannelGroup.updateClientContext] revision must be a non-negative safe integer.')
    }
    const updated = this.updateLocalClientContext(connectionId, context, scope, revision)
    if (this.options.pubsub) {
      if (!isJSONValue(context)) throw new Error('[SSEChannelGroup.updateClientContext] clientContext must be JSON-safe with pubsub.')
      await this.options.pubsub.publish(this.controlTopic, {
        kind: 'control', data: { type: 'updateClientContext', connectionId, clientContext: context,
          ...(scope ? { scope } : {}), ...(revision !== undefined ? { revision } : {}) },
      })
    }
    return { updated }
  }

  getClientContext(connectionId: string): TClientContext | undefined {
    for (const channel of this.connectionIndex.get(connectionId) ?? []) {
      const value = this.channels.get(channel)?.clientContext
      if (value !== undefined) return value
    }
    return undefined
  }

  async dispose(): Promise<void> {
    await this.controlUnsubscribe?.()
    this.controlUnsubscribe = undefined
    for (const unsubscribe of this.topicUnsubscribers.values()) await unsubscribe()
    this.topicUnsubscribers.clear()
  }

  private broadcastRaw(signal: UniversalSignal | UniversalSignal[], predicate: (meta: TMeta | undefined) => boolean): void {
    validateSignalPayload(signal)
    const eventId = this.eventStore?.add(signal).id
    const errors: unknown[] = []
    for (const [channel, entry] of this.channels) {
      if (!predicate(entry.meta)) continue
      try { this.deliver(channel, signal, eventId) } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Broadcast encountered runtime errors')
  }

  private deliver(channel: SSEChannel, signal: UniversalSignal | UniversalSignal[], eventId?: string): void {
    try { channel.invalidate(signal, eventId) }
    catch (error) {
      if (error instanceof ChannelClosedError) this.deregister(channel)
      else throw error
    }
  }

  private validateMeta(meta: TMeta | undefined): TMeta | undefined {
    return this.options.metaSchema ? validateStandardSchema(meta, this.options.metaSchema) : meta
  }

  private validateTopics(topics: string[] | undefined): void {
    for (const topic of topics ?? []) validateTopic(topic, 'topics entry')
  }

  private attachTopic(channel: SSEChannel, topic: string): void {
    let channels = this.topicChannels.get(topic)
    if (!channels) this.topicChannels.set(topic, channels = new Set())
    channels.add(channel)
    if (this.options.pubsub && !this.topicUnsubscribers.has(topic)) {
      void this.options.pubsub.subscribe(topic, (message) => {
        if (message.kind !== 'signal') return
        const eventId = this.eventStore?.add(message.data, message.id).id ?? message.id
        for (const subscribed of this.topicChannels.get(topic) ?? []) {
          try {
            this.deliver(subscribed, message.data, eventId)
          } catch (error) {
            console.error('[SSEChannelGroup] Failed to deliver pubsub signal to channel:', error)
          }
        }
      }).then((unsubscribe) => this.topicUnsubscribers.set(topic, unsubscribe))
    }
  }

  private detachTopics(channel: SSEChannel, topics: Iterable<string>): void {
    for (const topic of topics) {
      const channels = this.topicChannels.get(topic)
      channels?.delete(channel)
      if (channels?.size === 0) {
        this.topicChannels.delete(topic)
        const unsubscribe = this.topicUnsubscribers.get(topic)
        this.topicUnsubscribers.delete(topic)
        if (unsubscribe) void unsubscribe()
      }
    }
  }

  private async subscribeControl(): Promise<void> {
    if (!this.options.pubsub) return
    this.controlUnsubscribe = await this.options.pubsub.subscribe(this.controlTopic, (message) => {
      if (message.kind === 'inlineData') { void this.deliverInlineData(message.topic, message.payload); return }
      if (message.kind !== 'control' || !isRecord(message.data) || typeof message.data.type !== 'string') return
      if (message.data.type === 'revokeWhere' && 'criteria' in message.data && isJSONValue(message.data.criteria)) {
        for (const [channel, entry] of this.channels) {
          if (matchesCriteria(channel.connectionId, entry.meta, message.data.criteria)) channel.revoke()
        }
      }
      if (message.data.type === 'revokeByConnectionId' && typeof message.data.connectionId === 'string') {
        this.closeConnection(message.data.connectionId, readScope(message.data))
      }
      if (message.data.type === 'updateClientContext' && typeof message.data.connectionId === 'string' && 'clientContext' in message.data) {
        const raw = message.data.clientContext
        const scope = readScope(message.data)
        const revision = typeof message.data.revision === 'number' ? message.data.revision : undefined
        if (this.options.clientContextSchema) {
          const context = validateStandardSchema(raw, this.options.clientContextSchema)
          this.updateLocalClientContext(message.data.connectionId, context, scope, revision)
        } else if (this.isClientContext(raw)) {
          this.updateLocalClientContext(message.data.connectionId, raw, scope, revision)
        }
      }
    })
  }

  private closeConnection(connectionId: string, scope?: Record<string, JSONValue>): boolean {
    let closed = false
    for (const channel of Array.from(this.connectionIndex.get(connectionId) ?? [])) {
      const entry = this.channels.get(channel)
      if (!entry || (scope && !isScopeMatch(entry.meta, scope))) continue
      channel.revoke()
      closed = true
    }
    return closed
  }

  private updateLocalClientContext(
    connectionId: string, context: TClientContext, scope?: Record<string, JSONValue>, revision?: number,
  ): boolean {
    const latest = this.clientContextRevisions.get(connectionId)
    if (revision !== undefined && latest !== undefined && revision < latest) return false
    let updated = false
    for (const channel of this.connectionIndex.get(connectionId) ?? []) {
      const entry = this.channels.get(channel)
      if (entry && (!scope || isScopeMatch(entry.meta, scope))) { entry.clientContext = context; updated = true }
    }
    if (updated && revision !== undefined) this.clientContextRevisions.set(connectionId, revision)
    return updated
  }

  private async deliverInlineData(topic: string, payload: JSONValue): Promise<void> {
    const resolver = this.options.resolveInlineData
    if (!resolver) throw new Error('[SSEChannelGroup.pushInlineData] resolveInlineData must be configured.')
    const channels = Array.from(this.topicChannels.get(topic) ?? [])
    const connections = channels.map((channel) => {
      const entry = this.channels.get(channel)
      return { connectionId: channel.connectionId, meta: entry?.meta, clientContext: entry?.clientContext }
    })
    const resolved = await resolver(connections, payload)
    const missingConnectionIds = connections.filter((connection) => !resolved.has(connection.connectionId)).map((connection) => connection.connectionId)
    if (missingConnectionIds.length) {
      console.warn(
        `[SSEChannelGroup] resolveInlineData returned no result for ${missingConnectionIds.length} connection(s) on topic "${topic}". Missing IDs: ${missingConnectionIds.join(', ')}`
      )
      this.options.onInlineDataResolverError?.({ topic, missingConnectionIds })
    }
    const errors: unknown[] = []
    for (const channel of channels) {
      const result = resolved.get(channel.connectionId)
      if (!result) continue
      const signal: UniversalSignal = result.inlineData === undefined
        ? result.signal
        : { key: result.signal.key, inlineData: result.inlineData, ...(result.markStale ? { markStale: true } : {}) }
      try {
        this.deliver(channel, signal)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Inline data delivery encountered runtime errors')
  }

  private isClientContext(value: unknown): value is TClientContext {
    if (this.options.clientContextSchema) {
      const result = this.options.clientContextSchema['~standard'].validate(value)
      return !(result instanceof Promise) && !result.issues
    }
    return true
  }
}

function validateTopic(topic: string, label: string): void {
  if (typeof topic !== 'string' || topic.replace(/(?:\s|\u200B|\u200C|\u200D|\uFEFF)/gu, '') === '') {
    throw new Error(`[SSEChannelGroup] ${label} must be a non-empty, non-whitespace string.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeScope(scope: Record<string, JSONValue | undefined> | undefined): Record<string, JSONValue> | undefined {
  if (!scope) return undefined
  const result: Record<string, JSONValue> = {}
  for (const [key, value] of Object.entries(scope)) if (value !== undefined) {
    if (!isJSONValue(value)) throw new Error('[SSEChannelGroup] scope values must be valid JSONValues.')
    result[key] = value
  }
  if (!Object.keys(result).length) throw new Error('[SSEChannelGroup] scope must contain at least one non-undefined property.')
  return result
}

function readScope(value: Record<string, unknown>): Record<string, JSONValue> | undefined {
  return 'scope' in value && isRecord(value.scope) && isJSONValue(value.scope) ? value.scope : undefined
}

function isScopeMatch(meta: unknown, scope: Record<string, JSONValue>): boolean {
  return isRecord(meta) && Object.entries(scope).every(([key, value]) => matchesJson(meta[key], value, false))
}

function matchesCriteria(connectionId: string, meta: unknown, criteria: JSONValue): boolean {
  if (isRecord(criteria) && 'connectionId' in criteria && criteria.connectionId !== connectionId) return false
  if (!isRecord(criteria)) return matchesJson(meta, criteria, false)
  if (!isRecord(meta)) return false
  return Object.entries(criteria).every(([key, value]) => key === 'connectionId' || matchesJson(meta[key], value, false))
}

function isMetaMatchedByKey(meta: unknown, key: JSONValue[], exact: boolean): boolean {
  const metaKey: JSONValue[] = isJSONValueArray(meta) ? meta : isJSONValue(meta) ? [meta] : []
  if (exact ? metaKey.length !== key.length : metaKey.length < key.length) return false
  return key.every((part, index) => matchesJson(metaKey[index], part, exact))
}

function matchesJson(actual: unknown, expected: JSONValue, exact: boolean): boolean {
  if (actual === expected) return true
  if (!isJSONValue(actual) || actual === null || expected === null ||
    typeof actual !== 'object' || typeof expected !== 'object') return false
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return false
    if (exact ? actual.length !== expected.length : actual.length < expected.length) return false
    return expected.every((part, index) => matchesJson(actual[index], part, exact))
  }
  const actualRecord = actual as Record<string, JSONValue>
  const expectedRecord = expected as Record<string, JSONValue>
  if (exact && Object.keys(actualRecord).length !== Object.keys(expectedRecord).length) return false
  return Object.entries(expectedRecord).every(([key, value]) =>
    Object.hasOwn(actualRecord, key) && matchesJson(actualRecord[key], value, exact))
}

