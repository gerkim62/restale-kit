import type { InvalidateSignal } from './types.js'
import type { StandardSchemaV1 } from './standard-schema.js'
import type { SSEChannel } from './channel.js'
import { ChannelClosedError, SchemaValidationError } from './errors.js'

/**
 * Manages a group of SSE channels for multi-client broadcasting.
 *
 * Channels are registered with associated metadata, which can be used to
 * scope broadcasts via a predicate function. Channels that throw
 * `ChannelClosedError` during broadcast are automatically deregistered.
 *
 * @typeParam TSignal - The invalidation signal type (must extend `InvalidateSignal`).
 * @typeParam TMeta - The metadata type associated with each channel.
 */
export class SSEChannelGroup<
  TSignal extends InvalidateSignal = InvalidateSignal,
  TMeta = unknown,
> {
  private readonly channels = new Map<SSEChannel<TSignal>, TMeta>()
  private readonly metaSchema?: StandardSchemaV1<unknown, TMeta>

  constructor(options?: { metaSchema?: StandardSchemaV1<unknown, TMeta> }) {
    this.metaSchema = options?.metaSchema
  }

  /** Number of active channels in the group. */
  get size(): number {
    return this.channels.size
  }

  /**
   * Registers a channel with its associated metadata.
   *
   * If `metaSchema` was provided to the constructor, validates the metadata
   * synchronously. Throws `SchemaValidationError` if validation fails or
   * if the schema returns a Promise (async schemas are not supported).
   */
  register(channel: SSEChannel<TSignal>, meta: TMeta): void {
    if (this.metaSchema) {
      const result = this.metaSchema['~standard'].validate(meta)

      if (result instanceof Promise) {
        throw new SchemaValidationError([{ message: 'async schemas are not supported' }])
      }

      if (result.issues) {
        throw new SchemaValidationError(result.issues)
      }
    }

    this.channels.set(channel, meta)
  }

  /** Deregisters a channel from the group. */
  deregister(channel: SSEChannel<TSignal>): void {
    this.channels.delete(channel)
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

    for (const [channel, meta] of this.channels) {
      if (!predicate(meta)) continue

      try {
        channel.invalidate(signal)
      } catch (error) {
        if (error instanceof ChannelClosedError) {
          this.channels.delete(channel)
        } else {
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
    const errors: unknown[] = []

    for (const [channel] of this.channels) {
      try {
        channel.invalidate(signal)
      } catch (error) {
        if (error instanceof ChannelClosedError) {
          this.channels.delete(channel)
        } else {
          errors.push(error)
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, 'Broadcast encountered validation or runtime errors')
    }
  }
}
