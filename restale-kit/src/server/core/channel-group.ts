import { type InvalidateSignal, type EventStore, type JSONValue, type PubSubMessage, isJSONValue, matchesJSONValue, matchesInvalidateSignalKey, SignalTarget } from '@/types/protocol.js'
import { type StandardSchemaV1, validateStandardSchema } from '@/types/standard-schema.js'
import { processTargetSignals, type SSEChannel } from '@/server/core/channel.js'
import { ChannelClosedError, SchemaValidationError } from '@/types/errors.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import { createEventStore } from '@/server/core/event-store.js'
import { PROTOCOL_CONSTANTS } from '@/utils/constants.js'

/**
 * Manages subscription state and serialization for a specific topic.
 *
 * NOTE: Even when the `pubsub` adapter is undefined (single-instance fallback),
 * `TopicManager` is still instantiated and populated. In this scenario, it serves
 * as a local index of registered channels per topic, facilitating fast O(1) routing
 * inside `publish(topic, ...)` without iterating over all channels in the group.
 */
class TopicManager<TSignal extends InvalidateSignal = InvalidateSignal> {
  readonly channels = new Set<SSEChannel<TSignal>>()
  private unsubscribeFn?: () => void | Promise<void>
  private isSubscribed = false
  private pendingOp = Promise.resolve()

  constructor(
    private readonly topic: string,
    private readonly pubsub: PubSubAdapter<TSignal> | undefined,
    private readonly onMessage: (message: PubSubMessage<TSignal>) => void,
    private readonly onTeardown?: (topic: string) => void
  ) {}

  add(channel: SSEChannel<TSignal>): void {
    this.channels.add(channel)
    this.sync()
  }

  remove(channel: SSEChannel<TSignal>): void {
    this.channels.delete(channel)
    this.sync()
  }

  get size(): number {
    return this.channels.size
  }

  private sync(): void {
    const pubsub = this.pubsub
    if (!pubsub) {
      if (this.channels.size === 0) {
        this.onTeardown?.(this.topic)
      }
      return
    }

    const wantsSubscribe = this.channels.size > 0
    if (wantsSubscribe && !this.isSubscribed) {
      this.isSubscribed = true
      this.pendingOp = this.pendingOp
        .then(async () => {
          if (this.channels.size === 0) {
            this.isSubscribed = false
            this.onTeardown?.(this.topic)
            return
          }
          if (this.unsubscribeFn) {
            // Already subscribed (e.g. from a prior task that finished in time)
            this.isSubscribed = true
            return
          }
          let attempts = 0
          const maxAttempts = 5
          let delay = 100

          const sleep = (ms: number) => {
            const start = Date.now()
            return new Promise<void>((resolve) => {
              const interval = setInterval(() => {
                if (Date.now() - start >= ms || this.channels.size === 0) {
                  clearInterval(interval)
                  resolve()
                }
              }, 50)
            })
          }

          for (;;) {
            if (this.channels.size === 0) {
              this.isSubscribed = false
              this.onTeardown?.(this.topic)
              return
            }
            try {
              const unsub = await pubsub.subscribe(this.topic, this.onMessage)
              this.unsubscribeFn = unsub
              if (this.channels.size === 0) {
                this.unsubscribeFn = undefined
                this.isSubscribed = false
                await unsub()
                this.onTeardown?.(this.topic)
              }
              break
            } catch (err) {
              attempts++
              if (attempts >= maxAttempts || this.channels.size === 0) {
                this.isSubscribed = false
                this.onTeardown?.(this.topic)
                console.error(`[ERROR][TopicManager.subscribe] Failed to subscribe to topic "${this.topic}" after ${attempts.toString()} attempts:`, err)
                break
              }
              await sleep(delay)
              delay = Math.min(delay * 2, 2000)
            }
          }
        })
        .catch((err: unknown) => {
          console.error(`[ERROR][TopicManager.sync] Unexpected error in subscribe chain for topic "${this.topic}":`, err)
        })
    } else if (!wantsSubscribe && this.isSubscribed) {
      this.isSubscribed = false
      this.pendingOp = this.pendingOp
        .then(async () => {
          if (this.channels.size > 0) {
            this.isSubscribed = true
            return
          }
          const unsub = this.unsubscribeFn
          this.unsubscribeFn = undefined
          if (unsub) {
            try {
              await unsub()
            } catch (err) {
              // Note: `isSubscribed` remains false to keep state consistent after unsubscribe failure.
              console.error(`[ERROR][TopicManager.unsubscribe] Failed to unsubscribe from topic "${this.topic}":`, err)
            }
          }
          if (this.channels.size === 0) {
            this.onTeardown?.(this.topic)
          }
        })
        .catch((err: unknown) => {
          console.error(`[ERROR][TopicManager.sync] Unexpected error in unsubscribe chain for topic "${this.topic}":`, err)
        })
    }
  }
}


export interface SSEChannelGroupOptions<
  TSignal extends InvalidateSignal = InvalidateSignal,
  TMeta = unknown,
> {
  metaSchema?: StandardSchemaV1<unknown, TMeta>
  pubsub?: PubSubAdapter<TSignal>
  eventStore?: EventStore<TSignal>
  eventBufferCapacity?: number
  controlTopic?: string
  target?: SignalTarget | SignalTarget[]
}

/**
 * Manages a group of SSE channels for multi-client broadcasting and pub/sub synchronization.
 *
 * @typeParam TSignal - The invalidation signal type (must extend `InvalidateSignal`).
 * @typeParam TMeta - The metadata type associated with each channel.
 */
export class SSEChannelGroup<
  TSignal extends InvalidateSignal = InvalidateSignal,
  TMeta = unknown,
> {
  private readonly channels = new Map<SSEChannel<TSignal>, { meta: TMeta; topics: Set<string>; connectionId: string }>()
  private readonly connectionIndex = new Map<string, Set<SSEChannel<TSignal>>>()
  private readonly topics = new Map<string, TopicManager<TSignal>>()
  private readonly metaSchema?: StandardSchemaV1<unknown, TMeta>
  private readonly pubsub?: PubSubAdapter<TSignal>
  readonly eventStore?: EventStore<TSignal>
  readonly controlTopic: string
  readonly target?: SignalTarget | SignalTarget[]

  private controlUnsubscribeFn?: () => void | Promise<void>
  private controlPendingOp: Promise<void> = Promise.resolve()

  constructor(options?: SSEChannelGroupOptions<TSignal, TMeta>) {
    this.metaSchema = options?.metaSchema
    this.pubsub = options?.pubsub
    this.target = options?.target

    const rawControlTopic = options?.controlTopic ?? PROTOCOL_CONSTANTS.DEFAULT_CONTROL_TOPIC
    if (typeof rawControlTopic !== 'string' || rawControlTopic.trim() === '') {
      throw new Error(
        `[SSEChannelGroup] controlTopic must be a non-empty, non-whitespace string. ` +
        `Got: ${JSON.stringify(rawControlTopic)}`
      )
    }
    this.controlTopic = rawControlTopic

    if (options?.eventStore) {
      this.eventStore = options.eventStore
    } else if (options?.eventBufferCapacity !== undefined && options.eventBufferCapacity > 0) {
      this.eventStore = createEventStore<TSignal>({ capacity: options.eventBufferCapacity })
    }

    if (this.pubsub) {
      this.initControlSubscription()
    }
  }

  /** Number of active channels in the group. */
  get size(): number {
    return this.channels.size
  }

  private initControlSubscription(): void {
    const pubsub = this.pubsub
    if (!pubsub) return

    this.controlPendingOp = this.controlPendingOp.then(async () => {
      let attempts = 0
      let delay = 100

      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

      for (;;) {
        try {
          const unsub = await pubsub.subscribe(this.controlTopic, (msg) => {
            if (msg.kind === 'control') {
              const dataObj = msg.data
              if (
                dataObj &&
                typeof dataObj === 'object' &&
                !Array.isArray(dataObj) &&
                'type' in dataObj &&
                dataObj.type === 'revokeByConnectionId' &&
                'revokeByConnectionId' in dataObj
              ) {
                const revokePayload = dataObj.revokeByConnectionId
                if (revokePayload && typeof revokePayload === 'object' && !Array.isArray(revokePayload)) {
                  if ('connectionId' in revokePayload && typeof revokePayload.connectionId === 'string') {
                    const connectionId = revokePayload.connectionId
                    let scope: Record<string, JSONValue> | undefined = undefined
                    if ('scope' in revokePayload) {
                      const scopeVal = revokePayload.scope
                      if (scopeVal && typeof scopeVal === 'object' && !Array.isArray(scopeVal)) {
                        scope = scopeVal
                      }
                    }
                    this.closeLocalConnection(connectionId, scope)
                  }
                }
              } else {
                this.closeLocalMatches(msg.data)
              }
            }
          })
          this.controlUnsubscribeFn = unsub
          break
        } catch (err) {
          attempts++
          console.error(
            `[ERROR][SSEChannelGroup.initControlSubscription] Failed to subscribe to control topic "${this.controlTopic}" (attempt ${attempts.toString()}):`,
            err
          )
          await sleep(delay)
          delay = Math.min(delay * 2, 2000)
        }
      }
    })
  }

  /**
   * Closes local channels whose metadata matches the criteria via subset matching.
   */
  private closeLocalMatches(criteria: JSONValue): number {
    let localClosed = 0
    const channelEntries = Array.from(this.channels.entries())
    for (const [ch, entry] of channelEntries) {
      if (channelMatchesCriteria(ch, entry.meta, criteria)) {
        try {
          ch.revoke()
        } catch {
          // Ignore close errors on already closed channels
        }
        this.deregister(ch)
        localClosed++
      }
    }
    return localClosed
  }

  private closeLocalConnection(connectionId: string, scope?: Record<string, JSONValue>): boolean {
    const channels = this.connectionIndex.get(connectionId)
    if (!channels || channels.size === 0) return false

    let closedAny = false
    for (const channel of Array.from(channels)) {
      if (scope !== undefined) {
        const entry = this.channels.get(channel)
        if (!entry) continue
        const meta = entry.meta
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue
        if (!isJSONValue(meta)) continue
        // Use structural deep equality so nested objects/arrays in scope match
        // correctly — including values reconstructed after remote serialization.
        if (!matchesJSONValue(meta, scope, false)) continue
      }

      try {
        channel.revoke()
      } catch {
        // already closed
      }
      this.deregister(channel)
      closedAny = true
    }
    return closedAny
  }

  /**
   * Helper to deliver a signal to a single channel and handle closed connection cleanup/errors.
   */
  private deliverToChannel(
    channel: SSEChannel<TSignal>,
    signal: TSignal | TSignal[],
    context: string,
    topic?: string,
    eventId?: string
  ): void {
    try {
      const effectiveSignal = (this.target !== undefined && channel.target === undefined)
        ? processTargetSignals(signal, this.target)
        : signal
      channel.invalidate(effectiveSignal, eventId)
    } catch (error) {
      if (error instanceof ChannelClosedError) {
        this.deregister(channel)
      } else {
        const err = error instanceof Error ? error : new Error(String(error))
        console.error(
          `[ERROR][SSEChannelGroup.${context}] Failed to invalidate channel` +
          (topic ? ` on topic "${topic}"` : ""),
          err.stack || err.message
        )
      }
      if (context === 'broadcast') {
        throw error
      }
    }
  }

  /**
   * Registers a channel with its associated metadata and optional routing topics.
   *
   * If `metaSchema` was provided to the constructor, validates the metadata
   * synchronously. Throws `SchemaValidationError` if validation fails or
   * if the schema returns a Promise (async schemas are not supported).
   *
   * The channel is automatically deregistered when it closes — no manual cleanup required.
   * The channel's `connectionId` is stored internally and never needs to appear in `TMeta`.
   */
  register(
    channel: SSEChannel<TSignal>,
    ...args: undefined extends TMeta
      ? [meta?: TMeta, options?: { topics?: string[] }]
      : [meta: TMeta, options?: { topics?: string[] }]
  ): void {
    const meta = args[0]
    const options = args[1]

    let validatedMeta: TMeta
    if (this.metaSchema) {
      validatedMeta = validateStandardSchema(meta, this.metaSchema)
    } else {
      // When no metaSchema is provided, `meta` is the raw args[0] value, typed as
      // `TMeta | undefined`. The overload signature guarantees that `undefined` is
      // only reachable here when `undefined extends TMeta` (i.e., undefined IS a
      // valid TMeta), so this cast is always safe at runtime.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- safe: undefined only reachable when undefined extends TMeta (see overload)
      validatedMeta = meta as TMeta
    }

    const topicsList = options?.topics || []
    const topicsSet = new Set(topicsList)

    const existingEntry = this.channels.get(channel)
    if (existingEntry) {
      // Find topics that were dropped
      for (const oldTopic of existingEntry.topics) {
        if (!topicsSet.has(oldTopic)) {
          const topicManager = this.topics.get(oldTopic)
          if (topicManager) {
            topicManager.remove(channel)
            if (topicManager.size === 0) {
              this.topics.delete(oldTopic)
            }
          }
        }
      }
    }

    const connectionId = channel.connectionId
    this.channels.set(channel, { meta: validatedMeta, topics: topicsSet, connectionId })
    if (connectionId) {
      let set = this.connectionIndex.get(connectionId)
      if (!set) {
        set = new Set()
        this.connectionIndex.set(connectionId, set)
      }
      set.add(channel)
    }

    for (const topic of topicsSet) {
      let topicManager = this.topics.get(topic)
      if (!topicManager) {
        topicManager = new TopicManager(
          topic,
          this.pubsub,
          (msg) => {
            if (msg.kind !== 'signal') return
            const currentManager = this.topics.get(topic)
            if (!currentManager) return
            let effectiveId = msg.id
            if (this.eventStore !== undefined) {
              const record = this.eventStore.add(msg.data, msg.id)
              effectiveId = record.id
            }
            for (const ch of currentManager.channels) {
              this.deliverToChannel(ch, msg.data, 'pubsub', topic, effectiveId)
            }
          },
          (t) => {
            this.topics.delete(t)
          }
        )
        this.topics.set(topic, topicManager)
      }
      if (!existingEntry || !existingEntry.topics.has(topic)) {
        topicManager.add(channel)
      }
    }

    // Auto-deregister when the channel closes. Only wire once (new channels only).
    if (!existingEntry) {
      channel.onClose(() => { this.deregister(channel) })
    }
  }

  /** Deregisters a channel from the group. */
  deregister(channel: SSEChannel<TSignal>): void {
    const entry = this.channels.get(channel)
    if (!entry) return

    this.channels.delete(channel)
    if (entry.connectionId) {
      const set = this.connectionIndex.get(entry.connectionId)
      if (set) {
        set.delete(channel)
        if (set.size === 0) {
          this.connectionIndex.delete(entry.connectionId)
        }
      }
    }

    for (const topic of entry.topics) {
      const topicManager = this.topics.get(topic)
      if (topicManager) {
        topicManager.remove(channel)
      }
    }
  }

  /**
   * Revokes connections by subset-matching channel metadata against `criteria`.
   *
   * Closes all matching channels locally and broadcasts the criteria to the cluster-wide control topic.
   *
   * Use this for bulk operations: log out all sessions for a user, ban a tenant, close all
   * connections matching a role. Every channel whose registered metadata is a superset of
   * `criteria` is closed.
   *
   * **Note:** Channels whose stored metadata is `undefined` are excluded from criteria-based matching
   * because `undefined` is not a valid JSON value. To revoke such channels, use `revokeByConnectionId(connectionId)` instead.
   *
   * ## Security: do not use connectionId as the sole criteria
   *
   * `connectionId` is generated by the client and sent as a URL query parameter — it is an opaque
   * correlation value, NOT an authentication credential. If you pass `{ connectionId: someId }`
   * as the sole criteria, any HTTP client that knows (or guesses) a connection ID can trigger
   * revocation of someone else's connection.
   *
   * Always combine `connectionId` with trusted server-side identity when targeting a single
   * connection, or use `revokeByConnectionId(connectionId, { userId, ... })` which enforces
   * scope-pinning explicitly:
   *
   * ```ts
   * // ✅ Safe bulk revoke — criteria comes entirely from server-side auth context
   * await group.revokeWhere({ userId: req.user.id })
   *
   * // ✅ Safe single-connection revoke with scope-pinning
   * await group.revokeByConnectionId(connectionId, { userId: req.user.id })
   *
   * // ❌ Unsafe — connectionId is client-supplied and can be forged
   * await group.revokeWhere({ connectionId: req.body.connectionId })
   * ```
   */
  async revokeWhere(criteria: JSONValue): Promise<{ localClosed: number }> {
    if (!isJSONValue(criteria)) {
      throw new Error('[SSEChannelGroup.revokeWhere] criteria must be a valid JSONValue.')
    }

    const localClosed = this.closeLocalMatches(criteria)

    if (this.pubsub) {
      await this.pubsub.publish(this.controlTopic, { kind: 'control', data: criteria })
    }

    return { localClosed }
  }

  /**
   * Target-revokes channels for a specific `connectionId`, with optional scope-pinning against `TMeta`.
   *
   * Closes matching local channels immediately and broadcasts a targeted control message
   * to all cluster instances so remote connections for `connectionId` are closed as well.
   *
   * @param connectionId - The opaque `__restale_cid__` value sent by the client.
   * @param scope - Optional metadata object that must match the channel's registered `TMeta`.
   *                Enforces security scope-pinning so clients cannot revoke connectionIds belonging
   *                to other users or tenants.
   */
  async revokeByConnectionId(connectionId: string, scope?: Record<string, JSONValue>): Promise<{ closed: boolean }> {
    if (typeof connectionId !== 'string' || connectionId.trim() === '') {
      throw new Error('[SSEChannelGroup.revokeByConnectionId] connectionId must be a non-empty string.')
    }

    if (scope !== undefined) {
      const scopeVal: unknown = scope
      if (!scopeVal || typeof scopeVal !== 'object' || Array.isArray(scopeVal) || !isJSONValue(scopeVal)) {
        throw new Error('[SSEChannelGroup.revokeByConnectionId] scope must be a non-null JSON plain object.')
      }
    }

    const localClosed = this.closeLocalConnection(connectionId, scope)

    if (this.pubsub) {
      await this.pubsub.publish(this.controlTopic, {
        kind: 'control',
        data: {
          type: 'revokeByConnectionId',
          revokeByConnectionId: {
            connectionId,
            ...(scope !== undefined ? { scope } : {}),
          },
        },
      })
    }

    return { closed: localClosed }
  }

  /**
   * Unsubscribes from the control topic and cleans up PubSub resources.
   */
  async dispose(): Promise<void> {
    await this.controlPendingOp
    const unsub = this.controlUnsubscribeFn
    this.controlUnsubscribeFn = undefined
    if (unsub) {
      try {
        await unsub()
      } catch (err) {
        console.error(
          `[ERROR][SSEChannelGroup.dispose] Failed to unsubscribe control topic "${this.controlTopic}":`,
          err
        )
      }
    }
  }

  /**
   * Broadcasts to channels matching the predicate.
   *
   * - If a channel throws `ChannelClosedError`, it is automatically deregistered
   *   and iteration continues.
   * - Any other errors (e.g. `SchemaValidationError`) are collected across all
   *   channels and thrown as an `AggregateError` at the end — iteration always
   *   completes. The errored channel is NOT deregistered (it may succeed next time).
   */
  broadcast(signal: TSignal | TSignal[], predicate: (meta: TMeta) => boolean): void {
    const effectiveSignal = this.target !== undefined ? processTargetSignals(signal, this.target) : signal
    const errors: unknown[] = []
    let eventId: string | undefined = undefined
    if (this.eventStore !== undefined) {
      const record = this.eventStore.add(effectiveSignal)
      eventId = record.id
    }

    // NOTE: Deleting entries from the `Map` during `for...of` iteration is fully safe in JS.
    // Deletions of already-visited or current keys do not impact the iterator loop, and
    // deregistration side effects (like topic cleanup) are localized to the deregistered channel.
    for (const [channel, entry] of this.channels) {
      const shouldInclude = predicate(entry.meta)

      if (!shouldInclude) continue

      try {
        this.deliverToChannel(channel, effectiveSignal, 'broadcast', undefined, eventId)
      } catch (error) {
        if (error instanceof ChannelClosedError) {
          this.deregister(channel)
        } else {
          const err = error instanceof Error ? error : new Error(String(error))
          const issues = error instanceof SchemaValidationError ? error.issues : undefined
          console.error(
            "[ERROR][SSEChannelGroup.broadcast] Failed to invalidate channel",
            "\n  metadata:", JSON.stringify(entry.meta, null, 2).slice(0, 500),
            "\n  signal:", JSON.stringify(signal, null, 2).slice(0, 500),
            issues ? "\n  schemaIssues: " + JSON.stringify(issues, null, 2) : "",
            "\n  error:", err.stack || err.message
          )
          errors.push(error)
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, 'Broadcast encountered validation or runtime errors')
    }
  }

  /**
   * Explicitly broadcasts to ALL channels in the group.
   *
   * Forces the caller to consciously opt in to a blanket broadcast.
   *
   * - If a channel throws ChannelClosedError, it is automatically deregistered.
   * - Any other errors are collected and thrown at the end of the broadcast.
   */
  broadcastToAll(signal: TSignal | TSignal[]): void {
    this.broadcast(signal, () => true)
  }

  /**
   * Broadcasts to channels whose metadata matches the signal's key using the
   * same hierarchical prefix/exact matching semantics as the wire protocol.
   *
   * The signal's `key` is matched against channel metadata treated as a
   * `JSONValue`. A channel receives the signal when its metadata is a JSON
   * object whose fields are a superset of the signal's key objects.
   *
   * This eliminates the need to write manual predicate functions that mirror
   * what the signal key already expresses.
   *
   * @example
   * // Instead of:
   * group.broadcast({ key: ['todos', { userId }] }, (meta) => meta.userId === userId)
   * // You can write:
   * group.broadcastByKey({ key: ['todos', { userId }] })
   */
  broadcastByKey(signal: TSignal): void {
    this.broadcast(signal, (meta) => {
      if (!isJSONValue(meta)) return false
      // Wrap scalar/array meta in an array to match against the signal key
      const metaKey = Array.isArray(meta) ? meta : [meta]
      return matchesInvalidateSignalKey(metaKey, signal)
    })
  }

  /**
   * Publishes an invalidation signal to all local and remote subscribers on `topic`.
   *
   * Deliver to matching local channels first (synchronously), then publishes to the PubSub broker.
   * Errors from the broker publish propagate to the caller.
   */
  async publish(topic: string, signal: TSignal | TSignal[]): Promise<void> {
    const effectiveSignal = this.target !== undefined ? processTargetSignals(signal, this.target) : signal
    let eventId: string | undefined = undefined
    if (this.eventStore !== undefined) {
      const record = this.eventStore.add(effectiveSignal)
      eventId = record.id
    }

    // 1. Deliver to local channels registered on topic
    const topicManager = this.topics.get(topic)
    if (topicManager) {
      for (const channel of topicManager.channels) {
        this.deliverToChannel(channel, effectiveSignal, 'publish', topic, eventId)
      }
    }

    // 2. Publish to the broker
    if (this.pubsub) {
      await this.pubsub.publish(topic, { kind: 'signal', data: effectiveSignal, id: eventId })
    }
  }
}

function channelMatchesCriteria(ch: SSEChannel, meta: unknown, criteria: JSONValue): boolean {
  if (!isJSONValue(meta)) return false

  // 1. Direct match on metadata
  if (matchesJSONValue(meta, criteria, false)) {
    return true
  }

  // 2. Match on combined object if metadata is an object
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const combined = { ...meta, connectionId: ch.connectionId }
    if (matchesJSONValue(combined, criteria, false)) {
      return true
    }
  }

  // 3. Match on connectionId alone if criteria is an object containing connectionId
  if (criteria && typeof criteria === 'object' && !Array.isArray(criteria)) {
    const criteriaObj = criteria as Record<string, JSONValue>
    if ('connectionId' in criteriaObj) {
      if (ch.connectionId !== criteriaObj.connectionId) {
        return false
      }
      const otherKeys = Object.keys(criteriaObj).filter(k => k !== 'connectionId')
      if (otherKeys.length === 0) {
        return true
      }
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
        const remainingCriteria: Record<string, JSONValue> = {}
        for (const k of otherKeys) {
          remainingCriteria[k] = criteriaObj[k]
        }
        return matchesJSONValue(meta, remainingCriteria, false)
      }
      return false
    }
  }

  return false
}

