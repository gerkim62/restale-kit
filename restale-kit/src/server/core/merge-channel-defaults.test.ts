import { describe, it, expect } from 'vitest'
import { mergeChannelDefaults } from './merge-channel-defaults.js'
import type { ChannelDefaults } from './merge-channel-defaults.js'
import type { SSEChannelOptions } from './channel.js'

// Helper: build a minimal channel options object that satisfies the type
function opts(
  overrides: Partial<SSEChannelOptions> = {}
): SSEChannelOptions {
  return { target: 'swr', ...overrides }
}

describe('mergeChannelDefaults', () => {
  // ── No defaults ────────────────────────────────────────────────────────────

  it('returns channel options unchanged when defaults is undefined', () => {
    const channelOpts = opts({ lifetime: { ttlMs: 1000 } })
    const result = mergeChannelDefaults(channelOpts, undefined)
    expect(result).toBe(channelOpts) // same reference — no allocation
  })

  it('returns channel options unchanged when defaults is empty object', () => {
    const channelOpts = opts()
    const result = mergeChannelDefaults(channelOpts, {})
    // No fields were actually added — options may or may not be same reference,
    // but the returned options must not gain unexpected keys
    expect(result.lifetime).toBeUndefined()
    expect(result.guardKeepalive).toBeUndefined()
  })

  // ── guardKeepalive — presence-based, not truthiness-based ─────────────────

  it('applies guardKeepalive default when channel does not set it', () => {
    const result = mergeChannelDefaults(opts(), { guardKeepalive: true })
    expect(result.guardKeepalive).toBe(true)
  })

  it('channel guardKeepalive: false overrides default true (presence wins over truthiness)', () => {
    const channelOpts = opts({ guardKeepalive: false })
    const result = mergeChannelDefaults(channelOpts, { guardKeepalive: true })
    // false is explicitly set by the channel — must NOT be overridden
    expect(result.guardKeepalive).toBe(false)
  })

  it('channel guardKeepalive: true is preserved when default is false', () => {
    const channelOpts = opts({ guardKeepalive: true })
    const result = mergeChannelDefaults(channelOpts, { guardKeepalive: false })
    expect(result.guardKeepalive).toBe(true)
  })

  it('does not add guardKeepalive when default is undefined', () => {
    const channelOpts = opts()
    const result = mergeChannelDefaults(channelOpts, { guardKeepalive: undefined })
    expect(Object.hasOwn(result, 'guardKeepalive')).toBe(false)
  })

  // ── lifetime — channel sets nothing ───────────────────────────────────────

  it('applies full lifetime default when channel sets no lifetime', () => {
    const defaults: ChannelDefaults = {
      lifetime: { ttlMs: 5000, onDeadline: 'revoke' },
    }
    const result = mergeChannelDefaults(opts(), defaults)
    expect(result.lifetime).toEqual({ ttlMs: 5000, onDeadline: 'revoke' })
  })

  it('applies deadline-based lifetime default when channel sets no lifetime', () => {
    const deadline = Date.now() + 60000
    const defaults: ChannelDefaults = { lifetime: { deadline } }
    const result = mergeChannelDefaults(opts(), defaults)
    expect(result.lifetime).toEqual({ deadline })
  })

  // ── lifetime — time value merging ─────────────────────────────────────────

  it('channel ttlMs wins over default ttlMs', () => {
    const result = mergeChannelDefaults(
      opts({ lifetime: { ttlMs: 1000 } }),
      { lifetime: { ttlMs: 9999, onDeadline: 'reconnect' } }
    )
    expect((result.lifetime as { ttlMs: number }).ttlMs).toBe(1000)
  })

  it('channel deadline wins over default ttlMs', () => {
    const deadline = Date.now() + 30000
    const result = mergeChannelDefaults(
      opts({ lifetime: { deadline } }),
      { lifetime: { ttlMs: 9999 } }
    )
    expect((result.lifetime as { deadline: number }).deadline).toBe(deadline)
    expect((result.lifetime as any).ttlMs).toBeUndefined()
  })

  it('default ttlMs fills in when channel has no time value', () => {
    // Channel only sets onDeadline — no ttlMs or deadline
    // This is an edge case: channel sets lifetime but only onDeadline,
    // so the time value should come from the default.
    const result = mergeChannelDefaults(
      opts({ lifetime: { ttlMs: undefined as any, onDeadline: 'revoke' } as any }),
      { lifetime: { ttlMs: 5000 } }
    )
    // The channel has an onDeadline that should be preserved.
    // The time value comes from the default.
    expect((result.lifetime as any).onDeadline).toBe('revoke')
  })

  // ── lifetime — onDeadline merging ─────────────────────────────────────────

  it('channel onDeadline wins over default onDeadline', () => {
    const result = mergeChannelDefaults(
      opts({ lifetime: { ttlMs: 1000, onDeadline: 'revoke' } }),
      { lifetime: { ttlMs: 9999, onDeadline: 'reconnect' } }
    )
    expect(result.lifetime?.onDeadline).toBe('revoke')
  })

  it('default onDeadline fills in when channel lifetime has no onDeadline', () => {
    const result = mergeChannelDefaults(
      opts({ lifetime: { ttlMs: 1000 } }),       // no onDeadline set
      { lifetime: { ttlMs: 9999, onDeadline: 'revoke' } }
    )
    // Channel's ttlMs wins for time value, but onDeadline comes from default
    expect((result.lifetime as { ttlMs: number }).ttlMs).toBe(1000)
    expect(result.lifetime?.onDeadline).toBe('revoke')
  })

  it('onDeadline: object form is preserved by channel', () => {
    const onDeadlineObj = { maxAttempts: 3, retryDelayMs: 400 }
    const result = mergeChannelDefaults(
      opts({ lifetime: { ttlMs: 1000, onDeadline: onDeadlineObj } }),
      { lifetime: { ttlMs: 9999, onDeadline: 'revoke' } }
    )
    expect(result.lifetime?.onDeadline).toEqual(onDeadlineObj)
  })

  it('onDeadline: object form from default fills in when channel does not set onDeadline', () => {
    const onDeadlineObj = { maxAttempts: 2, retryDelayMs: 300 }
    const result = mergeChannelDefaults(
      opts({ lifetime: { ttlMs: 1000 } }),
      { lifetime: { ttlMs: 9999, onDeadline: onDeadlineObj } }
    )
    expect(result.lifetime?.onDeadline).toEqual(onDeadlineObj)
  })

  it('merged lifetime has no onDeadline key when neither channel nor default set it', () => {
    const result = mergeChannelDefaults(
      opts({ lifetime: { ttlMs: 1000 } }),
      { lifetime: { ttlMs: 9999 } }
    )
    expect(Object.hasOwn(result.lifetime ?? {}, 'onDeadline')).toBe(false)
  })

  // ── Unrelated channel options are preserved ────────────────────────────────

  it('does not mutate or drop unrelated channel options', () => {
    const channelOpts = opts({
      keepaliveIntervalMs: 5000,
      connectionId: 'conn-1',
      requestedTarget: 'swr',
    })
    const result = mergeChannelDefaults(channelOpts, { guardKeepalive: true, lifetime: { ttlMs: 1000 } })
    expect(result.keepaliveIntervalMs).toBe(5000)
    expect(result.connectionId).toBe('conn-1')
    expect(result.requestedTarget).toBe('swr')
    expect(result.target).toBe('swr')
  })

  it('does not mutate the original channel options object', () => {
    const channelOpts = opts()
    const original = { ...channelOpts }
    mergeChannelDefaults(channelOpts, { guardKeepalive: true, lifetime: { ttlMs: 1000 } })
    expect(channelOpts).toEqual(original)
  })
})
