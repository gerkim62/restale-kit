import type { InvalidateSignal } from '@/types/protocol.js'
import { type StandardSchemaV1, validateStandardSchema } from '@/types/standard-schema.js'
import type { SSEChannel } from '@/server/core/channel.js'
import { ChannelClosedError, SchemaValidationError } from '@/types/errors.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'

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
    private readonly onMessage: (signal: TSignal | TSignal[]) => void
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

  constructor(options?: {
    metaSchema?: StandardSchemaV1<unknown, TMeta>
    pubsub?: PubSubAdapter<TSignal>
  }) {
    this.metaSchema = options?.metaSchema
    this.pubsub = options?.pubsub
  }

  /** Number of active channels in the group. */
  get size(): number {
    return this.channels.size
  }

  /**
   * Helper to deliver a signal to a single channel and handle closed connection cleanup/errors.
   */
  private deliverToChannel(
    channel: SSEChannel<TSignal>,
    signal: TSignal | TSignal[],
    context: string,
    topic?: string
  ): void {
    try {
      channel.invalidate(signal)
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
        topicManager = new TopicManager(topic, this.pubsub, (signal) => {
          // Deliver to all channels registered to this topic.
          // Query the live map to avoid closing over stale topicManager instances
          // during topic teardown and recreation.
          const currentManager = this.topics.get(topic)
          if (!currentManager) return

          for (const ch of currentManager.channels) {
            this.deliverToChannel(ch, signal, 'pubsub', topic)
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
   * Broadcasts to channels matching the predicate.
   *
   * - If a channel throws `ChannelClosedError`, it is automatically deregistered
   *   and iteration continues.
   * - Any other errors (including `SchemaValidationError`) are skipped —
   *   the failed channel is deregistered and iteration continues.
   */
  broadcast(signal: TSignal | TSignal[], predicate: (meta: TMeta) => boolean): void {
    const errors: unknown[] = []

    // NOTE: Deleting entries from the `Map` during `for...of` iteration is fully safe in JS.
    // Deletions of already-visited or current keys do not impact the iterator loop, and
    // deregistration side effects (like topic cleanup) are localized to the deregistered channel.
    for (const [channel, entry] of this.channels) {
      if (!predicate(entry.meta)) continue

      try {
        channel.invalidate(signal)
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
    // 1. Deliver to local channels registered on topic
    const topicManager = this.topics.get(topic)
    if (topicManager) {
      for (const channel of topicManager.channels) {
        this.deliverToChannel(channel, signal, 'publish', topic)
      }
    }

    // 2. Publish to the broker
    if (this.pubsub) {
      await this.pubsub.publish(topic, signal)
    }
  }
}
