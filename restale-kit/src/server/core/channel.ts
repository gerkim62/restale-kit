import {
  isJSONValue,
  isCacheKey,
  type BeforeFrameFn,
  type ChannelState,
  type EventStore,
  type FrameGuardCtx,
  type FrameGuardResult,
  type LifetimeOptions,
  type Signal,
} from '@/types/protocol.js'
import { ChannelClosedError } from '@/types/errors.js'
import { createEventStore } from '@/server/core/event-store.js'
import {
  formatConnectedFrame,
  formatInvalidateFrame,
  formatKeepalive,
  formatRenewFrame,
  formatRetryFrame,
  formatRevokeFrame,
} from '@/server/core/framing.js'
import { FRAME_GUARD_DEFAULTS, PROTOCOL_CONSTANTS } from '@/utils/constants.js'
import { generateUUID } from '@/utils/id.js'

export interface SSEChannelOptions {
  keepaliveIntervalMs?: number
  retryIntervalMs?: number
  lastEventId?: string
  eventStore?: EventStore
  eventBufferCapacity?: number
  idGenerator?: () => string
  lifetime?: LifetimeOptions
  beforeFrame?: BeforeFrameFn
  guardKeepalive?: boolean
}

/** @internal Request-derived options supplied by built-in transport adapters. */
export type SSEChannelTransportOptions = SSEChannelOptions

export interface SSEChannel {
  readonly state: ChannelState
  readonly connectionId: string
  readonly stream: ReadableStream<Uint8Array>
  readonly invalidate: (signal: Signal | Signal[], customId?: string) => string
  close(): void
  disconnect(): void
  revoke(reason?: string): void
  onClose(callback: () => void): void
}

export function createSSEChannel(options: SSEChannelOptions = {}): SSEChannel {
  validateChannelOptions(options)
  const keepaliveIntervalMs = options.keepaliveIntervalMs ?? PROTOCOL_CONSTANTS.DEFAULT_KEEPALIVE_INTERVAL_MS
  const connectionId = generateUUID()
  const isResume = options.lastEventId !== undefined
  const ownsEventStore = options.eventStore === undefined
  const capacity = options.eventBufferCapacity ?? (options.eventStore === undefined && options.lifetime ? 50 : undefined)
  const eventStore = options.eventStore ?? (capacity && capacity > 0
    ? createEventStore({ capacity, ...(options.idGenerator ? { idGenerator: options.idGenerator } : {}) })
    : undefined)

  let state: ChannelState = 'open'
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined
  let lifetimeTimer: ReturnType<typeof setTimeout> | undefined
  const closeCallbacks: Array<() => void> = []

  function closeInternal(): void {
    if (state === 'closed') return
    state = 'closed'
    if (keepaliveTimer !== undefined) clearInterval(keepaliveTimer)
    if (lifetimeTimer !== undefined) clearTimeout(lifetimeTimer)
    keepaliveTimer = undefined
    lifetimeTimer = undefined
    try { controller?.close() } catch { /* stream already closed */ }
    for (const callback of closeCallbacks.splice(0)) {
      try { callback() } catch { /* callback failures cannot reopen a channel */ }
    }
  }

  function runGuard(ctx: FrameGuardCtx): FrameGuardResult {
    if (!options.beforeFrame || (ctx.frameType === 'keepalive' && !options.guardKeepalive)) {
      return { action: 'send' }
    }
    try {
      return options.beforeFrame(ctx)
    } catch {
      return { action: 'close' }
    }
  }

  function revoke(reason = 'revoked'): void {
    if (state === 'closed') return
    try { controller?.enqueue(formatRevokeFrame(reason)) } catch { /* best effort */ }
    closeInternal()
  }

  function replay(): void {
    if (options.lastEventId === undefined || eventStore === undefined || !controller) return
    const result = eventStore.getEventsAfter(options.lastEventId)
    if (result.stale) {
      controller.enqueue(formatInvalidateFrame({ key: [] }))
      return
    }
    for (const event of result.events) controller.enqueue(formatInvalidateFrame(event.signal, event.id))
  }

  function scheduleLifetime(connectedAt: number): void {
    if (!options.lifetime) return
    const rawDelay = 'ttlMs' in options.lifetime
      ? options.lifetime.ttlMs
      : options.lifetime.deadline - connectedAt
    const delay = Math.max(
      FRAME_GUARD_DEFAULTS.DEADLINE_MIN_FIRE_DELAY_MS,
      rawDelay + Math.random() * FRAME_GUARD_DEFAULTS.DEADLINE_JITTER_WINDOW_MS,
    )
    lifetimeTimer = setTimeout(() => {
      if (state !== 'open') return
      const onDeadline = options.lifetime?.onDeadline ?? 'reconnect'
      if (onDeadline === 'revoke') {
        revoke('deadline')
        return
      }
      const maxAttempts = typeof onDeadline === 'object'
        ? onDeadline.maxAttempts ?? FRAME_GUARD_DEFAULTS.RENEW_MAX_ATTEMPTS
        : FRAME_GUARD_DEFAULTS.RENEW_MAX_ATTEMPTS
      const retryDelayMs = typeof onDeadline === 'object'
        ? onDeadline.retryDelayMs ?? FRAME_GUARD_DEFAULTS.RENEW_RETRY_DELAY_MS
        : FRAME_GUARD_DEFAULTS.RENEW_RETRY_DELAY_MS
      try { controller?.enqueue(formatRenewFrame(maxAttempts, retryDelayMs)) } finally { closeInternal() }
    }, delay)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
      streamController.enqueue(formatConnectedFrame(connectionId))
      if (options.retryIntervalMs !== undefined) streamController.enqueue(formatRetryFrame(options.retryIntervalMs))
      try { replay() } catch { closeInternal(); return }
      if (keepaliveIntervalMs > 0) {
        keepaliveTimer = setInterval(() => {
          if (state !== 'open') return
          const result = runGuard({ frameType: 'keepalive', signal: undefined, connectionId, isResume })
          if (result.action === 'skip') return
          if (result.action === 'close') {
            revoke(result.reason)
            return
          }
          try { streamController.enqueue(formatKeepalive()) } catch { closeInternal() }
        }, keepaliveIntervalMs)
      }
      scheduleLifetime(Date.now())
    },
    cancel: closeInternal,
  })

  function invalidate(signal: UniversalSignal | UniversalSignal[], customId?: string): string {
    if (state === 'closed') throw new ChannelClosedError()
    validateSignalPayload(signal)
    const result = runGuard({ frameType: 'signal', signal, connectionId, isResume })
    if (result.action === 'skip') return ''
    if (result.action === 'close') {
      revoke(result.reason)
      throw new ChannelClosedError()
    }
    let eventId = customId ?? options.idGenerator?.()
    if (eventStore) {
      if (ownsEventStore || customId === undefined) {
        eventId = eventStore.add(signal, eventId).id
      } else if (eventStore.getEventsAfter(customId).stale) {
        eventId = eventStore.add(signal, customId).id
      }
    }
    try { controller?.enqueue(formatInvalidateFrame(signal, eventId)) } catch {
      closeInternal()
      throw new ChannelClosedError()
    }
    return eventId ?? ''
  }

  return {
    get state() { return state },
    connectionId,
    stream,
    invalidate,
    close: closeInternal,
    disconnect: closeInternal,
    revoke,
    onClose(callback) {
      if (state === 'closed') callback()
      else closeCallbacks.push(callback)
    },
  }
}

/** Runtime validation for a signal or non-empty signal batch. */
export function validateSignalPayload(signal: unknown): asserts signal is Signal | Signal[] {
  const signals = Array.isArray(signal) ? signal : [signal]
  if (signals.length === 0) throw new Error('[invalidate] Signals must be a non-empty array or object.')
  for (const value of signals) {
    if (!isRecord(value)) {
      throw new Error('[invalidate] Every signal must be an object.')
    }
    const signalValue = value
    if (!isCacheKey(signalValue.key)) throw new Error('[invalidate] Signal key must be a JSONValue array.')
    if (isInlineDataSignalLike(signalValue)) {
      const unsupported = Object.keys(signalValue).filter((key) => key !== 'key' && key !== 'inlineData' && key !== 'markStale')
      if (unsupported.length > 0) {
        throw new Error(`[invalidate] Invalid inline-data signal: unsupported fields (${unsupported.join(', ')}).`)
      }
      if (!isJSONValue(signalValue.inlineData) || 'exact' in signalValue ||
          ('markStale' in signalValue && typeof signalValue.markStale !== 'boolean')) {
        throw new Error('[invalidate] Invalid inline-data signal.')
      }
    } else {
      const unsupported = Object.keys(signalValue).filter((key) => key !== 'key' && key !== 'exact')
      if (unsupported.length > 0) {
        throw new Error(`[invalidate] Invalid revalidate signal: unsupported fields (${unsupported.join(', ')}).`)
      }
      if ('markStale' in signalValue || ('exact' in signalValue && typeof signalValue.exact !== 'boolean')) {
        throw new Error('[invalidate] Invalid revalidate signal.')
      }
    }
  }
}

function isInlineDataSignalLike(signal: Record<string, unknown>): boolean {
  return Object.hasOwn(signal, 'inlineData')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateChannelOptions(options: SSEChannelOptions): void {
  const nonNegativeSafeInteger = (name: string, value: number | undefined) => {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`[createSSEChannel] ${name} must be a non-negative safe integer.`)
    }
  }
  nonNegativeSafeInteger('eventBufferCapacity', options.eventBufferCapacity)
  nonNegativeSafeInteger('retryIntervalMs', options.retryIntervalMs)
  if (options.keepaliveIntervalMs !== undefined &&
      (!Number.isFinite(options.keepaliveIntervalMs) || options.keepaliveIntervalMs < 0)) {
    throw new RangeError('[createSSEChannel] keepaliveIntervalMs must be a non-negative finite number.')
  }
  if (!options.lifetime) return
  const { ttlMs, deadline, onDeadline } = options.lifetime
  if (ttlMs !== undefined && deadline !== undefined) throw new Error('[createSSEChannel] lifetime.ttlMs and lifetime.deadline are mutually exclusive.')
  nonNegativeSafeInteger('lifetime.ttlMs', ttlMs)
  nonNegativeSafeInteger('lifetime.deadline', deadline)
  if (typeof onDeadline === 'object') {
    if (onDeadline.maxAttempts !== undefined && (!Number.isSafeInteger(onDeadline.maxAttempts) || onDeadline.maxAttempts < 1)) {
      throw new RangeError('[createSSEChannel] lifetime.onDeadline.maxAttempts must be a positive safe integer.')
    }
    nonNegativeSafeInteger('lifetime.onDeadline.retryDelayMs', onDeadline.retryDelayMs)
  }
}
