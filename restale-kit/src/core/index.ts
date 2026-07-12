// Core public API
export { createSSEChannel } from './channel.js'
export type { SSEChannel, SSEChannelOptions } from './channel.js'
export { SSEChannelGroup } from './channel-group.js'
export { ChannelClosedError, SchemaValidationError } from './errors.js'
export type {
  JSONValue,
  InvalidateSignal,
  SSEInvalidateEvent,
  ChannelState,
} from './types.js'
