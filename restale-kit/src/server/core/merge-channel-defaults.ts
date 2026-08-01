import { validateTargetConfiguration, type SSEChannelOptions } from '@/server/core/channel.js'
import type { InvalidateSignal, LifetimeOptions, OnDeadline, SignalTarget } from '@/types/protocol.js'

/**
 * The subset of `SSEChannelOptions` that `SSEChannelGroup.channelDefaults` may supply.
 *
 * `beforeFrame` is deliberately absent: it closes over per-request local variables
 * (userId, sessionId) and has no meaningful group-wide default (spec §1).
 */
export interface ChannelDefaults {
  target?: SignalTarget | SignalTarget[] | readonly SignalTarget[]
  lifetime?: LifetimeOptions
  guardKeepalive?: boolean
  eventBufferCapacity?: number
}

/**
 * Merges per-channel options with group `channelDefaults`, following the spec §1 rules:
 *
 * **Presence-based, not truthiness-based.**
 * A field is considered "set by the channel" when the channel options object literally
 * contains that key — `Object.hasOwn` is used, not `??` / `||`.
 * This means `guardKeepalive: false` on a channel correctly overrides a group default
 * of `true` (which a naive `??` merge would silently drop).
 *
 * **`lifetime` merges as two independent parts, not as one whole object.**
 * - The time value (`ttlMs` / `deadline`) — mutually exclusive, treated as one atomic pair.
 * - `onDeadline` — defaulted independently.
 *
 * If a channel sets only `{ ttlMs: 60_000 }`, it still inherits the group's `onDeadline`
 * default, because it never touched that field. A whole-object replace would silently drop it.
 */
export function mergeChannelDefaults<TSignal extends InvalidateSignal = InvalidateSignal>(
  channelOptions: SSEChannelOptions<TSignal>,
  defaults: ChannelDefaults | undefined
): SSEChannelOptions<TSignal> {
  if (channelOptions.target !== undefined) validateTargetConfiguration(channelOptions.target)
  if (defaults?.target !== undefined) validateTargetConfiguration(defaults.target)

  let merged = channelOptions

  if (defaults !== undefined) {
    // ── target ────────────────────────────────────────────────────────────────
    // Only apply default target when channel options does not provide target (or is undefined).
    if (
      defaults.target !== undefined &&
      (!Object.hasOwn(channelOptions, 'target') || channelOptions.target === undefined)
    ) {
      merged = { ...merged, target: defaults.target }
    }

    // ── guardKeepalive ────────────────────────────────────────────────────────
    if (
      defaults.guardKeepalive !== undefined &&
      !Object.hasOwn(channelOptions, 'guardKeepalive')
    ) {
      merged = { ...merged, guardKeepalive: defaults.guardKeepalive }
    }

    if (
      defaults.eventBufferCapacity !== undefined &&
      !Object.hasOwn(channelOptions, 'eventBufferCapacity')
    ) {
      merged = { ...merged, eventBufferCapacity: defaults.eventBufferCapacity }
    }

    // ── lifetime ──────────────────────────────────────────────────────────────
    if (defaults.lifetime !== undefined) {
      const channelLifetime = channelOptions.lifetime
      const defaultLifetime = defaults.lifetime

      if (channelLifetime === undefined) {
        // Channel set nothing — take the whole default as-is.
        merged = { ...merged, lifetime: defaultLifetime }
      } else {
        // Channel set something — merge the two independent parts.
        const mergedLifetime = mergeLifetimeParts(channelLifetime, defaultLifetime)
        merged = { ...merged, lifetime: mergedLifetime }
      }
    }
  }

  if (merged.target === undefined) {
    throw new Error('[mergeChannelDefaults] target is required.')
  }

  return merged
}

type TimeValueShape =
  | { ttlMs: number; deadline?: never }
  | { deadline: number; ttlMs?: never }
  | { ttlMs?: undefined; deadline?: undefined }

/**
 * Merges lifetime option parts independently:
 * - Time value (ttlMs / deadline): one atomic pair — channel wins if either is present AND not undefined.
 * - `onDeadline`: independent — defaults when the channel didn't set it or set it to undefined.
 */
function mergeLifetimeParts(
  channel: LifetimeOptions | { ttlMs?: number; deadline?: number; onDeadline?: OnDeadline; reconnect?: unknown },
  defaults: LifetimeOptions
): LifetimeOptions {
  // Determine which time value (if any) the channel explicitly set to a non-undefined value.
  const channelHasTtl = Object.hasOwn(channel, 'ttlMs') && channel.ttlMs !== undefined
  const channelHasDeadline = Object.hasOwn(channel, 'deadline') && channel.deadline !== undefined
  const channelHasTimeValue = channelHasTtl || channelHasDeadline

  // Determine whether the channel explicitly set onDeadline to a non-undefined value.
  const channelHasOnDeadline = Object.hasOwn(channel, 'onDeadline') && channel.onDeadline !== undefined
  const channelHasReconnect = Object.hasOwn(channel, 'reconnect') && channel.reconnect !== undefined

  // Resolve the time value to use.
  const timeValue: TimeValueShape = channelHasTimeValue
    ? resolveTimeValue(channel)
    : (defaults.ttlMs !== undefined || defaults.deadline !== undefined)
      ? resolveTimeValue(defaults)
      : {}

  // Resolve onDeadline: channel wins if present and not undefined, otherwise fall back to default.
  const onDeadline: OnDeadline | undefined = channelHasOnDeadline
    ? channel.onDeadline
    : defaults.onDeadline

  const reconnect: unknown = channelHasReconnect
    ? channel.reconnect
    : defaults.reconnect

  const res: Record<string, unknown> = { ...timeValue }
  if (onDeadline !== undefined) res.onDeadline = onDeadline
  if (reconnect !== undefined) res.reconnect = reconnect
  return res as LifetimeOptions
}

function resolveTimeValue(
  lifetime: LifetimeOptions | { ttlMs?: number; deadline?: number; onDeadline?: OnDeadline }
): TimeValueShape {
  if ('ttlMs' in lifetime && lifetime.ttlMs !== undefined) {
    return { ttlMs: lifetime.ttlMs }
  }
  if ('deadline' in lifetime && lifetime.deadline !== undefined) {
    return { deadline: lifetime.deadline }
  }
  return {}
}
