import type { PubSubMessage } from '@/types/protocol.js'

export type PubSubEncryptionOptions =
  | { encrypt?: false; encryptionKey?: never }
  | { encrypt?: true; encryptionKey: string }

export { PubSubDecryptionError } from './envelope.js'

/** A broker-agnostic adapter for universal protocol messages. */
export interface PubSubAdapter {
  readonly publish: (topic: string, message: PubSubMessage) => Promise<void>
  readonly subscribe: (
    topic: string,
    onMessage: (message: PubSubMessage) => void,
  ) => Promise<() => void | Promise<void>>
  readonly onError?: (handler: (error: unknown) => void) => void
}
