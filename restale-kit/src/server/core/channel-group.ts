import type { InvalidateSignal, EventStore, JSONValue, PubSubMessage } from '@/types/protocol.js'
import { isJSONValue, matchesJSONValue } from '@/types/protocol.js'
import { type StandardSchemaV1, validateStandardSchema } from '@/types/standard-schema.js'
import type { SSEChannel } from '@/server/core/channel.js'
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
    private readonly onMessage: (message: PubSubMessage<TSignal>) => void
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
    if (!pubsub) return

    const wantsSubscribe = this.channels.size > 0
    if (wantsSubscribe && !this.isSubscribed) {
      this.isSubscribed = true
      this.pendingOp = this.pendingOp
        .then(async () => {
          if (this.channels.size === 0) {
            this.isSubscribed = false
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
              return
            }
            try {
              const unsub = await pubsub.subscribe(this.topic, this.onMessage)
              this.unsubscribeFn = unsub
              if (this.channels.size === 0) {
                this.unsubscribeFn = undefined
                this.isSubscribed = false
                await unsub()
              }
              break
            } catch (err) {
              attempts++
              if (attempts >= maxAttempts || this.channels.size === 0) {
                this.isSubscribed = false
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
        })
        .catch((err: unknown) => {
          console.error(`[ERROR][TopicManager.sync] Unexpected error in unsubscribe chain for topic "${this.topic}":`, err)
        })
    }
  }
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
  private readonly channels = new Map<SSEChannel<TSignal>, { meta: TMeta; topics: Set<string> }>()
  private readonly topics = new Map<string, TopicManager<TSignal>>()
  private readonly metaSchema?: StandardSchemaV1<unknown, TMeta>
  private readonly pubsub?: PubSubAdapter<TSignal>
  readonly eventStore?: EventStore<TSignal>
  readonly controlTopic: string

  private controlUnsubscribeFn?: () => void | Promise<void>
  private controlPendingOp: Promise<void> = Promise.resolve()

  constructor(options?: {
    metaSchema?: StandardSchemaV1<unknown, TMeta>
    pubsub?: PubSubAdapter<TSignal>
    eventStore?: EventStore<TSignal>
    eventBufferCapacity?: number
    controlTopic?: string
  }) {
    this.metaSchema = options?.metaSchema
    this.pubsub = options?.pubsub
    this.controlTopic = options?.controlTopic ?? PROTOCOL_CONSTANTS.DEFAULT_CONTROL_TOPIC

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
              this.closeLocalMatches(msg.data)
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
      if (isJSONValue(entry.meta) && matchesJSONValue(entry.meta, criteria, false)) {
        try {
          ch.close()
        } catch {
          // Ignore close errors on already closed channels
        }
        this.deregister(ch)
        localClosed++
      }
    }
    return localClosed
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
      channel.invalidate(signal, eventId)
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
    }
  }

  /**
   * Registers a channel with its associated metadata and optional routing topics.
   *
   * If `metaSchema` was provided to the constructor, validates the metadata
   * synchronously. Throws `SchemaValidationError` if validation fails or
   * if the schema returns a Promise (async schemas are not supported).
   */
  register(channel: SSEChannel<TSignal>, meta: TMeta, options?: { topics?: string[] }): void {
    if (this.metaSchema) {
      validateStandardSchema(meta, this.metaSchema)
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

    this.channels.set(channel, { meta, topics: topicsSet })

    for (const topic of topicsSet) {
      let topicManager = this.topics.get(topic)
      if (!topicManager) {
        topicManager = new TopicManager(topic, this.pubsub, (msg) => {
          if (msg.kind !== 'signal') return
          // Deliver to all channels registered to this topic.
          // Query the live map to avoid closing over stale topicManager instances
          // during topic teardown and recreation.
          const currentManager = this.topics.get(topic)
          if (!currentManager) return

          for (const ch of currentManager.channels) {
            this.deliverToChannel(ch, msg.data, 'pubsub', topic)
          }
        })
        this.topics.set(topic, topicManager)
      }
      if (!existingEntry || !existingEntry.topics.has(topic)) {
        topicManager.add(channel)
      }
    }
  }

  /** Deregisters a channel from the group. */
  deregister(channel: SSEChannel<TSignal>): void {
    const entry = this.channels.get(channel)
    if (!entry) return

    this.channels.delete(channel)

    for (const topic of entry.topics) {
      const topicManager = this.topics.get(topic)
      if (topicManager) {
        topicManager.remove(channel)
        if (topicManager.size === 0) {
          this.topics.delete(topic)
        }
      }
    }
  }

  /**
   * Revokes channels matching `criteria`.
   *
   * 1. Closes and deregisters matching local channels immediately.
   * 2. If a pub/sub adapter is configured, publishes the revocation criteria to `controlTopic`.
   *
   * Returns `{ localClosed }`.
   */
  async revoke(criteria: JSONValue): Promise<{ localClosed: number }> {
    const localClosed = this.closeLocalMatches(criteria)

    if (this.pubsub) {
      await this.pubsub.publish(this.controlTopic, { kind: 'control', data: criteria })
    }

    return { localClosed }
  }

  /**
   * Tears down the control topic subscription idempotently.
   * Does NOT close registered client channels.
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
   * - Any other errors (including `SchemaValidationError`) are skipped —
   *   the failed channel is deregistered and iteration continues.
   */
  broadcast(signal: TSignal | TSignal[], predicate: (meta: TMeta) => boolean): void {
    const errors: unknown[] = []
    let eventId: string | undefined = undefined
    if (this.eventStore !== undefined) {
      const record = this.eventStore.add(signal)
      eventId = record.id
    }

    // NOTE: Deleting entries from the `Map` during `for...of` iteration is fully safe in JS.
    // Deletions of already-visited or current keys do not impact the iterator loop, and
    // deregistration side effects (like topic cleanup) are localized to the deregistered channel.
    for (const [channel, entry] of this.channels) {
      if (!predicate(entry.meta)) continue

      try {
        channel.invalidate(signal, eventId)
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
   * Publishes a signal to a topic.
   *
   * 1. Synchronously delivers the signal to any locally-held channels registered on the topic.
   * 2. If a pub/sub adapter is configured, asynchronously publishes the signal to the broker.
   *
   * Errors from the broker publish propagate to the caller.
   */
  async publish(topic: string, signal: TSignal | TSignal[]): Promise<void> {
    let eventId: string | undefined = undefined
    if (this.eventStore !== undefined) {
      const record = this.eventStore.add(signal)
      eventId = record.id
    }

    // 1. Deliver to local channels registered on topic
    const topicManager = this.topics.get(topic)
    if (topicManager) {
      for (const channel of topicManager.channels) {
        this.deliverToChannel(channel, signal, 'publish', topic, eventId)
      }
    }

    // 2. Publish to the broker
    if (this.pubsub) {
      await this.pubsub.publish(topic, { kind: 'signal', data: signal })
    }
  }
}

