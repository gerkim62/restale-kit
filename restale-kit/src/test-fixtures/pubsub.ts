import type { InvalidateSignal, PubSubMessage } from '@/types/protocol.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'

export class MemoryPubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal>
  implements PubSubAdapter<TSignal>
{
  private subscriptions = new Map<string, Set<(message: PubSubMessage<TSignal>) => void>>()
  private errorHandlers = new Set<(error: unknown) => void>()

  async publish(topic: string, message: PubSubMessage<TSignal>): Promise<void> {
    await Promise.resolve()
    const handlers = this.subscriptions.get(topic)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message)
        } catch (err) {
          this.emitError(err)
        }
      }
    }
  }

  async subscribe(
    topic: string,
    onMessage: (message: PubSubMessage<TSignal>) => void
  ): Promise<() => Promise<void>> {
    await Promise.resolve()
    let handlers = this.subscriptions.get(topic)
    if (!handlers) {
      handlers = new Set()
      this.subscriptions.set(topic, handlers)
    }
    handlers.add(onMessage)

    return async () => {
      await Promise.resolve()
      const current = this.subscriptions.get(topic)
      if (current) {
        current.delete(onMessage)
        if (current.size === 0) {
          this.subscriptions.delete(topic)
        }
      }
    }
  }

  onError(handler: (error: unknown) => void): void {
    this.errorHandlers.add(handler)
  }

  emitError(error: unknown): void {
    for (const handler of this.errorHandlers) {
      handler(error)
    }
  }

  getTopicSubscriberCount(topic: string): number {
    return this.subscriptions.get(topic)?.size ?? 0
  }

  clear(): void {
    this.subscriptions.clear()
    this.errorHandlers.clear()
  }
}

export function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
