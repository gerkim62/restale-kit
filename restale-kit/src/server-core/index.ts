// Core public API
export { createSSEChannel } from './channel.js'
export type { SSEChannel, SSEChannelOptions } from './channel.js'
export { SSEChannelGroup, type PubSubAdapter } from './channel-group.js'
export { ChannelClosedError, SchemaValidationError } from '../shared/errors.js'
export { isJSONValue, isJSONValueArray, matchesInvalidateSignalKey } from '../shared/types.js'
export type {
  JSONValue,
  InvalidateSignal,
  SSEInvalidateEvent,
  ChannelState,
} from '../shared/types.js'
