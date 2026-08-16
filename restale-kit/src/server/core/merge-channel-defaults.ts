import type { LifetimeOptions, OnDeadline } from '@/types/protocol.js'
import type { SSEChannelOptions } from '@/server/core/channel.js'

/** Group-level defaults that may safely be shared by channel connections. */
export interface ChannelDefaults {
  lifetime?: LifetimeOptions
  guardKeepalive?: boolean
  eventBufferCapacity?: number
}

export function mergeChannelDefaults(
  channelOptions: SSEChannelOptions,
  defaults: ChannelDefaults | undefined,
): SSEChannelOptions {
  if (!defaults) return channelOptions
  const merged: SSEChannelOptions = { ...channelOptions }
  if (defaults.guardKeepalive !== undefined && !Object.hasOwn(channelOptions, 'guardKeepalive')) {
    merged.guardKeepalive = defaults.guardKeepalive
  }
  if (defaults.eventBufferCapacity !== undefined && !Object.hasOwn(channelOptions, 'eventBufferCapacity')) {
    merged.eventBufferCapacity = defaults.eventBufferCapacity
  }
  if (defaults.lifetime !== undefined) {
    merged.lifetime = channelOptions.lifetime === undefined
      ? defaults.lifetime
      : mergeLifetimeParts(channelOptions.lifetime, defaults.lifetime)
  }
  return merged
}

function mergeLifetimeParts(channel: LifetimeOptions, defaults: LifetimeOptions): LifetimeOptions {
  const time = ('ttlMs' in channel && channel.ttlMs !== undefined) || ('deadline' in channel && channel.deadline !== undefined)
    ? channel
    : defaults
  const onDeadline: OnDeadline | undefined = channel.onDeadline ?? defaults.onDeadline
  return 'ttlMs' in time
    ? { ttlMs: time.ttlMs, ...(onDeadline !== undefined ? { onDeadline } : {}) }
    : { deadline: time.deadline, ...(onDeadline !== undefined ? { onDeadline } : {}) }
}
