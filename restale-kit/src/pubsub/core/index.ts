import type { InvalidateSignal } from '@/types/protocol.js'

/** A broker-agnostic adapter interface for pub/sub operations. */
export interface PubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal> {
  publish(topic: string, signal: TSignal | TSignal[]): Promise<void>
  subscribe(
    topic: string,
    onMessage: (signal: TSignal | TSignal[]) => void
  ): Promise<() => void | Promise<void>>
  onError?(handler: (error: unknown) => void): void
}
