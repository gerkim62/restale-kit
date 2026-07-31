import type { InvalidateSignal, PubSubMessage } from '@/types/protocol.js'

export type PubSubEncryptionOptions =
  | { encrypt?: false; encryptionKey?: never }
  | { encrypt?: true; encryptionKey: string }

export { PubSubDecryptionError } from './envelope.js'

/** A broker-agnostic adapter interface for pub/sub operations. */
export interface PubSubAdapter<TSignal extends InvalidateSignal = InvalidateSignal> {
  readonly _signalType?: TSignal
  readonly publish: (topic: string, message: PubSubMessage<TSignal>) => Promise<void>
  readonly subscribe: (
    topic: string,
    onMessage: (message: PubSubMessage<TSignal>) => void
  ) => Promise<() => void | Promise<void>>
  readonly onError?: (handler: (error: unknown) => void) => void
}

