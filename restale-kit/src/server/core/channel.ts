import {
  type InvalidateSignal,
  type ChannelState,
  type EventStore,
  type SignalTarget,
  type LifetimeOptions,
  type BeforeFrameFn,
  type FrameGuardCtx,
  type FrameGuardResult,
  type ReStaleSignalForTarget,
  type TargetForSignal,
  type SignalInputForTarget,
  isJSONValueArray,
  isJSONValue,
} from '@/types/protocol.js'
import { ChannelClosedError } from '@/types/errors.js'
import {
  formatInvalidateFrame,
  formatKeepalive,
  formatRevokeFrame,
  formatRetryFrame,
  formatRenewFrame,
} from '@/server/core/framing.js'
import { createEventStore } from '@/server/core/event-store.js'
import { PROTOCOL_CONSTANTS, FRAME_GUARD_DEFAULTS } from '@/utils/constants.js'

/**
 * Configuration options for `createSSEChannel`.
 * 
 * When used via a group's channelDefaults, `target` may be omitted.
 * When calling `createSSEChannel` directly, use `DirectSSEChannelOptions` which requires `target`.
 */
export interface SSEChannelOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  /** Target discriminator or target array for automatic signal tagging and multi-target fanout. Required unless provided via group channelDefaults. */
  target?: SignalTarget | SignalTarget[] | readonly SignalTarget[]
  /** Keepalive comment interval in milliseconds. Default: 0 (disabled). */
  keepaliveIntervalMs?: number
  /** Optional retry interval in milliseconds to send as a `retry: <ms>` frame on stream start. */
  retryIntervalMs?: number
  /** @internal Request-derived Last-Event-ID. Use `DirectSSEChannelOptions` for custom transport replay. */
  lastEventId?: string
  /** Shared EventStore for recording history and replaying missed events upon reconnect. */
  eventStore?: EventStore<TSignal>
  /** Capacity of automatically instantiated EventStore if `eventStore` is not provided. Defaults to 50 when `lifetime` options are set without an explicit `eventStore` or capacity. */
  eventBufferCapacity?: number
  /** Custom ID generator for assigned event frames. Ignored if an external `eventStore` is provided. */
  idGenerator?: () => string
  /** @internal Supplied by transport adapters from `__restale_cid__`. */
  connectionId?: string
  /** @internal Supplied by transport adapters from `__restale_target__`. */
  requestedTarget?: string
  /**
   * A connection-level deadline after which the channel is closed.
   *
   * Express either as a relative duration from connection start (`ttlMs`) or as an
   * absolute epoch-ms timestamp (`deadline`). The two are mutually exclusive.
   *
   * When the deadline fires, `onDeadline` (default `'reconnect'`) controls whether the
   * channel sends a `renew` frame (asking the client to make one confirmatory reconnect
   * through the real auth middleware) or a terminal `revoke` frame.
   */
  lifetime?: LifetimeOptions
  /**
   * Integrator-supplied guard function called synchronously before each outgoing frame.
   *
   * Gap 7: Properly typed as BeforeFrameFn<TSignal> to infer from channel's target/signal type.
   *
   * By default it runs before **signal frames only**. Set `guardKeepalive: true` to also
   * run it before every keepalive tick (opt-in because keepalives are high-frequency).
   *
   * The function must be synchronous. Errors thrown inside it are the integrator's
   * responsibility — an unhandled throw is treated as `{ action: 'close' }`.
   */
  beforeFrame?: BeforeFrameFn<TSignal>
  /**
   * When `true`, `beforeFrame` also runs before every keepalive tick.
   * Has no effect if `beforeFrame` is not set. Default: `false`.
   */
  guardKeepalive?: boolean
}

/**
 * A server-side SSE channel that produces a `ReadableStream<Uint8Array>`.
 *
 * Runtime-agnostic — does not know about Node's `http` module or any specific
 * framework. Transport helpers (`restale-kit/node`, `restale-kit/fetch`) pipe
 * this stream into their runtime's response mechanism.
 *
 * Gap 6: Methods are readonly function properties (contravariant) not method declarations.
 */
export interface SSEChannel<
  TSignal extends InvalidateSignal = InvalidateSignal,
  TTarget extends SignalTarget | readonly SignalTarget[] = SignalTarget | readonly SignalTarget[],
> {
  readonly _signalType?: TSignal
  /** Current lifecycle state of the channel. */
  readonly state: ChannelState
  /**
   * The unique connection ID sent by the client (`__restale_cid__`).
   * Use this to register connection-level metadata and support targeted revocation
   * (e.g. close a specific tab's connection on logout).
   */
  readonly connectionId: string
  /** Configured target discriminator or target array. Required. */
  readonly target: SignalTarget | readonly SignalTarget[]
  /** The single target requested by this client via query param, if any. May be an unrecognized string if the client sent an unknown target. */
  readonly requestedTarget: string | undefined
  /** The SSE byte stream to pipe into a response. */
  readonly stream: ReadableStream<Uint8Array>
  /**
   * Enqueue an invalidation signal (or batch) into the stream.
   *
   * - When `state` is `'closed'`: throws `ChannelClosedError`.
   *
   * Returns the event ID assigned to the invalidation frame.
   *
   * Gap 1.1 fix: Parameter is narrowed to TSignal only (not InvalidateSignal).
   */
  readonly invalidate: (
    signal: [TTarget] extends [readonly SignalTarget[]]
      ? SignalInputForTarget<TTarget>
      : TSignal | TSignal[],
    customId?: string
  ) => string
  /** Server-initiated close. Stops keepalive timer, closes the stream, transitions to `'closed'`. Idempotent. */
  close(): void
  /**
   * Called by a transport adapter when it detects the remote peer disconnected.
   * Same effect as `close()`. Idempotent.
   */
  /** @internal Called by transport adapters when the remote peer disconnects. */
  disconnect(): void
  /**
   * Sends a terminal `revoke` SSE event frame to the client and then closes the channel.
   *
   * The client uses this event to distinguish an intentional server-initiated revocation
   * (logout, session expiry, security kick) from a transient network error, and will
   * NOT automatically reconnect. The resulting client status is `{ status: 'closed', reason: 'revoked' }`.
   *
   * Idempotent — if the channel is already closed, this is a no-op.
   *
   * @param reason - Human-readable reason string included in the event payload. Default: `'revoked'`.
   */
  revoke(reason?: string): void
  /**
   * Registers a one-shot callback invoked when the channel transitions to `'closed'`
   * (whether via `close()`, `disconnect()`, `revoke()`, or stream cancellation).
   * If the channel is already closed the callback fires synchronously.
   */
  onClose(callback: () => void): void
}

export interface DirectSSEChannelOptions<
  TTarget extends SignalTarget | SignalTarget[] | readonly SignalTarget[] = SignalTarget | SignalTarget[],
  TSignal extends InvalidateSignal = InvalidateSignal,
> extends SSEChannelOptions<TSignal> {
  target: TTarget
  /** Last event ID for replay when implementing a custom low-level transport. */
  lastEventId?: string
}

/** @internal Request-derived options supplied only by built-in transport adapters. */
export interface SSEChannelTransportOptions<TSignal extends InvalidateSignal = InvalidateSignal>
  extends SSEChannelOptions<TSignal> {
  lastEventId?: string
  connectionId?: string
  requestedTarget?: string
}

/**
 * Creates a new SSE channel.
 *
 * The channel produces a standard `ReadableStream<Uint8Array>` containing
 * SSE-formatted events and periodic keepalive comments. Transport adapters
 * pipe this stream into a response.
 *
 * Gap 1.3a/b fixes: Overloads infer TSignal from target and validate consistency.
 */
export function createSSEChannel<TTarget extends SignalTarget>(
  options: { target: TTarget } & Omit<DirectSSEChannelOptions<TTarget, ReStaleSignalForTarget<TTarget>>, 'target'>
): SSEChannel<ReStaleSignalForTarget<TTarget>, TTarget>
export function createSSEChannel<TTarget extends readonly SignalTarget[]>(
  options: { target: TTarget } & Omit<DirectSSEChannelOptions<TTarget, ReStaleSignalForTarget<TTarget[number]>>, 'target'>
): SSEChannel<ReStaleSignalForTarget<TTarget[number]>, TTarget>
export function createSSEChannel<
  TSignal extends InvalidateSignal = InvalidateSignal,
  TTarget extends SignalTarget | SignalTarget[] | readonly SignalTarget[] = TargetForSignal<TSignal>,
>(
  options: DirectSSEChannelOptions<TTarget, TSignal>
): SSEChannel<TSignal, TTarget extends readonly SignalTarget[] ? TTarget : TTarget extends SignalTarget ? TTarget : SignalTarget>
export function createSSEChannel<TSignal extends InvalidateSignal = InvalidateSignal>(
  options: SSEChannelTransportOptions<TSignal>
): SSEChannel<TSignal> {
  if (options.target === undefined) {
    throw new Error('[createSSEChannel] target is required.')
  }
  const target = options.target
  validateTargetConfiguration(target)
  validateChannelOptions(options)
  const keepaliveIntervalMs =
    options.keepaliveIntervalMs ?? PROTOCOL_CONSTANTS.DEFAULT_KEEPALIVE_INTERVAL_MS
  const retryIntervalMs = options.retryIntervalMs
  const lastEventId = options.lastEventId
  const idGenerator = options.idGenerator
  const connectionId = options.connectionId ?? ''
  const requestedTarget = options.requestedTarget
  const beforeFrame = options.beforeFrame
  const guardKeepalive = options.guardKeepalive ?? false
  // True if the client provided a Last-Event-ID header — i.e. this is a reconnect.
  const isResume = lastEventId !== undefined

  // Auto-allocate default buffer capacity when lifetime deadline renewal is set without an eventStore
  const effectiveBufferCapacity =
    options.eventBufferCapacity ??
    (options.eventStore === undefined && options.lifetime !== undefined ? 50 : undefined)

  // Track whether this channel owns its eventStore (created internally) or was given an
  // external one. When the store is external (shared with a group), the group is responsible
  // for recording signals before calling invalidate() with a customId — the channel must not
  // call eventStore.add() a second time for the same event.
  const eventStore =
    options.eventStore ??
    (effectiveBufferCapacity !== undefined && effectiveBufferCapacity > 0
      ? createEventStore({ capacity: effectiveBufferCapacity, idGenerator })
      : undefined)
  const ownsEventStore = options.eventStore === undefined

  let state: ChannelState = 'open'
  let controller: ReadableStreamDefaultController<Uint8Array>
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined
  let lifetimeTimer: ReturnType<typeof setTimeout> | undefined
  const closeCallbacks: Array<() => void> = []

  // ── Lifetime timer helpers ────────────────────────────────────────────────

  function resolveLifetimeMs(connectedAt: number): number | undefined {
    if (options.lifetime === undefined) return undefined
    const { ttlMs, deadline } = options.lifetime
    if (ttlMs !== undefined) return ttlMs
    if (deadline === undefined) return undefined  
    return deadline - connectedAt
  }

  function scheduleLifetimeTimer(connectedAt: number): void {
    const rawDelayMs = resolveLifetimeMs(connectedAt)
    if (rawDelayMs === undefined) return

    // Apply jitter so connections sharing the same TTL don't all send renew simultaneously.
    const jitter = Math.random() * FRAME_GUARD_DEFAULTS.DEADLINE_JITTER_WINDOW_MS

    // Enforce the minimum-fire floor: even a deadline already in the past must not fire
    // immediately — it must wait at least DEADLINE_MIN_FIRE_DELAY_MS (spec §4.1.6).
    const fireDelayMs = Math.max(
      FRAME_GUARD_DEFAULTS.DEADLINE_MIN_FIRE_DELAY_MS,
      rawDelayMs + jitter
    )

    lifetimeTimer = setTimeout(() => {
      lifetimeTimer = undefined
      if (state !== 'open') return
      fireDeadline()
    }, fireDelayMs)
  }

  function fireDeadline(): void {
    if (state !== 'open') return

    const onDeadline = options.lifetime?.onDeadline ?? 'reconnect'

    if (onDeadline === 'revoke') {
      channelObj.revoke('deadline')
      return
    }

    // 'reconnect' (default) or object form — resolve maxAttempts / retryDelayMs.
    const maxAttempts =
      typeof onDeadline === 'object'
        ? (onDeadline.maxAttempts ?? FRAME_GUARD_DEFAULTS.RENEW_MAX_ATTEMPTS)
        : FRAME_GUARD_DEFAULTS.RENEW_MAX_ATTEMPTS
    const retryDelayMs =
      typeof onDeadline === 'object'
        ? (onDeadline.retryDelayMs ?? FRAME_GUARD_DEFAULTS.RENEW_RETRY_DELAY_MS)
        : FRAME_GUARD_DEFAULTS.RENEW_RETRY_DELAY_MS

    try {
      controller.enqueue(formatRenewFrame(maxAttempts, retryDelayMs))
    } catch {
      // controller already unusable — just close without the frame
    }
    closeInternal()
  }

  // ── Frame guard helper ────────────────────────────────────────────────────

  /**
   * Runs `beforeFrame` if it is configured for the given frame type.
   * Returns the result, or `{ action: 'send' }` when no guard is configured.
   * A thrown error inside `beforeFrame` is treated as `{ action: 'close' }` (spec §6).
   */
  function runGuard(ctx: FrameGuardCtx<TSignal>): FrameGuardResult {
    if (beforeFrame === undefined) return { action: 'send' }
    if (ctx.frameType === 'keepalive' && !guardKeepalive) return { action: 'send' }
    try {
      return beforeFrame(ctx)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.warn(
        '[WARN][createSSEChannel] beforeFrame threw an unhandled error — treating as { action: \'close\' }.',
        '\n  error:', error.stack || error.message
      )
      return { action: 'close' }
    }
  }

  // ── Stream ────────────────────────────────────────────────────────────────

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl
      const connectedAt = Date.now()

      // Validate the requested target before doing anything else.
      // If it is unsupported or missing on a multi-target channel, emit a structured revoke frame and close immediately.
      // Gap 2: Remove connectionId check - missing requestedTarget alone should reject multi-target connections
      const supportedTargets: string[] = typeof target === 'string' ? [target] : [...target]
      if (requestedTarget === undefined && supportedTargets.length > 1) {
        const safeConnectionId = connectionId.replace(/\r\n|\r|\n/g, '\\n')
        console.warn(
          `[WARN][createSSEChannel] Rejected connection: no target requested for multi-target channel [${supportedTargets.join(', ')}]. connectionId: ${safeConnectionId}.`
        )
        try {
          controller.enqueue(
            formatRevokeFrame('unsupported-target', {
              requested: '',
              supported: [...supportedTargets],
            })
          )
        } catch {
          // controller unusable
        }
        closeInternal()
        return
      }

      if (requestedTarget !== undefined) {
        if (!supportedTargets.some((supportedTarget) => supportedTarget === requestedTarget)) {
          const safeRequestedTarget = requestedTarget.replace(/\r\n|\r|\n/g, '\\n')
          const safeConnectionId = connectionId.replace(/\r\n|\r|\n/g, '\\n')
          console.warn(
            `[WARN][createSSEChannel] Rejected connection: requested target "${safeRequestedTarget}" not in supported set [${supportedTargets.join(', ')}]. connectionId: ${safeConnectionId}.`
          )
          try {
            controller.enqueue(
              formatRevokeFrame('unsupported-target', {
                requested: requestedTarget,
                supported: [...supportedTargets],
              })
            )
          } catch {
            // controller unusable — just close
          }
          closeInternal()
          return
        }
      }

      if (retryIntervalMs !== undefined) {
        try {
          controller.enqueue(formatRetryFrame(retryIntervalMs))
        } catch {
          closeInternal()
          return
        }
      }

      // Replay missed historical events if lastEventId and eventStore are present
      if (lastEventId !== undefined && eventStore !== undefined) {
        try {
          const { events: missed, stale } = eventStore.getEventsAfter(lastEventId)
          if (stale) {
            // The cursor fell off the ring buffer or was never valid — the client missed
            // an unknown number of events. Send a full-invalidate signal (key: []) so the
            // client refetches everything rather than silently displaying stale data.
            const declaredList: readonly SignalTarget[] = Array.isArray(target) ? target : (typeof target === 'string' ? [target] : [])
            let foundTarget: string | undefined = undefined
            for (const t of declaredList) {
              if (t === requestedTarget) {
                foundTarget = t
                break
              }
            }
            const defaultTarget = declaredList[0]
            const staleTarget: string = typeof foundTarget === 'string' ? foundTarget : (typeof defaultTarget === 'string' ? defaultTarget : 'generic')
            const staleSignal: InvalidateSignal =
              staleTarget === 'tanstack-query'
                ? { target: 'tanstack-query', queryKey: [] }
                : staleTarget === 'swr'
                  ? { target: 'swr', key: [] }
                  : staleTarget === 'rtk-query'
                    ? { target: 'rtk-query', tags: [] }
                    : { target: 'generic', key: [] }
            controller.enqueue(formatInvalidateFrame(staleSignal))
          } else {
            for (const record of missed) {
              const replaySignal = record.signal

              // Apply requestedTarget filter: skip signals that don't match this client's
              // requested target (same semantics as the live invalidate() filter path).
              if (requestedTarget !== undefined) {
                if (Array.isArray(replaySignal)) {
                  const filtered = replaySignal.filter((s) => {
                    const t = 'target' in s ? s.target : undefined
                    return t === requestedTarget
                  })
                  if (filtered.length === 0) continue
                  controller.enqueue(formatInvalidateFrame(filtered, record.id))
                  continue
                } else {
                  const t = 'target' in replaySignal ? replaySignal.target : undefined
                  if (t !== requestedTarget) continue
                }
              }

              controller.enqueue(formatInvalidateFrame(replaySignal, record.id))
            }
          }
        } catch {
          closeInternal()
          return
        }
      }

      if (keepaliveIntervalMs > 0) {
        keepaliveTimer = setInterval(() => {
          if (state !== 'open') return

          // Run the guard before every keepalive tick when guardKeepalive is enabled.
          if (beforeFrame !== undefined && guardKeepalive) {
            const ctx: FrameGuardCtx<InvalidateSignal> = {
              signal: undefined,
              frameType: 'keepalive',
              connectionId,
              requestedTarget,
              isResume,
            }
            const result = runGuard(ctx)
            if (result.action === 'skip') return
            if (result.action === 'close') {
              channelObj.revoke(result.reason)
              return
            }
          }

          try {
            controller.enqueue(formatKeepalive())
          } catch {
            closeInternal()
          }
        }, keepaliveIntervalMs)
      }

      scheduleLifetimeTimer(connectedAt)
    },
    cancel() {
      // Stream consumer cancelled — treat as disconnect
      closeInternal()
    },
  })

  // ── closeInternal ─────────────────────────────────────────────────────────

  function closeInternal(): void {
    if (state === 'closed') return
    state = 'closed'
    if (keepaliveTimer !== undefined) {
      clearInterval(keepaliveTimer)
      keepaliveTimer = undefined
    }
    if (lifetimeTimer !== undefined) {
      clearTimeout(lifetimeTimer)
      lifetimeTimer = undefined
    }
    try {
      if (controller.desiredSize !== null) {
        controller.close()
      }
    } catch (err) {
      console.debug('[closeInternal] Controller close error:', String(err))
    }
    // Fire one-shot close callbacks
    for (const cb of closeCallbacks) {
      try { cb() } catch { /* ignore errors in close callbacks */ }
    }
    closeCallbacks.length = 0
  }

  // ── invalidate ────────────────────────────────────────────────────────────

  function invalidate(signal: TSignal | TSignal[], customId?: string): string {
    if (state === 'closed') {
      throw new ChannelClosedError()
    }

    const effectiveSignal = validateSignalTargets<TSignal>(signal, target)

    // Filter by requestedTarget: drop signals that don't match the client's requested target.
    if (requestedTarget !== undefined) {
      if (Array.isArray(effectiveSignal)) {
        const filtered = effectiveSignal.filter((s) => {
          const t = 'target' in s ? s.target : undefined
          const keep = t === requestedTarget
          return keep
        })
        if (filtered.length === 0) return ''
        // Re-assign and continue with the filtered batch
        return invalidateFiltered(filtered, customId)
      } else {
        const t = 'target' in effectiveSignal ? effectiveSignal.target : undefined
        if (t !== requestedTarget) {
          return ''
        }
      }
    }

    return invalidateFiltered(effectiveSignal, customId)
  }

  function invalidateFiltered(
    effectiveSignal: TSignal | TSignal[],
    customId?: string
  ): string {
    // Run the frame guard before the signal frame is enqueued.
    if (beforeFrame !== undefined) {
      const ctx: FrameGuardCtx<TSignal> = {
        signal: effectiveSignal,
        frameType: 'signal',
        connectionId,
        requestedTarget,
        isResume,
      }
      const result = runGuard(ctx)
      if (result.action === 'skip') return ''
      if (result.action === 'close') {
        channelObj.revoke(result.reason)
        throw new ChannelClosedError()
      }
      // result.action === 'send' — fall through
    }

    let eventId = customId
    if (eventId === undefined && idGenerator !== undefined) {
      eventId = idGenerator()
    }

    if (eventStore !== undefined) {
      if (ownsEventStore || customId === undefined) {
        // Channel owns its store, or no id was provided — record it now.
        const record = eventStore.add(effectiveSignal, eventId)
        eventId = record.id
      } else {
        // External store with a customId provided: only skip add() when the record already
        // exists (i.e. the group pre-recorded it). If it is absent (standalone usage or an
        // unexpected call order), fall back to add() so the event is not silently lost.
        const { stale } = eventStore.getEventsAfter(customId)
        const alreadyRecorded = !stale
        if (!alreadyRecorded) {
          const record = eventStore.add(effectiveSignal, customId)
          eventId = record.id
        }
      }
    }

    try {
      controller.enqueue(formatInvalidateFrame(effectiveSignal, eventId))
    } catch {
      closeInternal()
      throw new ChannelClosedError()
    }

    return eventId ?? ''
  }

  // ── Public channel object ─────────────────────────────────────────────────

  const channelObj: SSEChannel<TSignal> = {
    get state() {
      return state
    },
    connectionId,
    target,
    requestedTarget,
    stream,
    invalidate,
    close: closeInternal,
    disconnect: closeInternal,
    revoke(reason: string = 'revoked'): void {
      if (state === 'closed') return
      try {
        controller.enqueue(formatRevokeFrame(reason))
      } catch {
        // If the stream controller is already unusable, skip the frame and just close.
      }
      closeInternal()
    },
    onClose(callback: () => void): void {
      if (state === 'closed') {
        try { callback() } catch { /* ignore errors */ }
      } else {
        closeCallbacks.push(callback)
      }
    },
  }

  return channelObj
}

/** Validates configured protocol targets before a channel or group is created. */
export function validateTargetConfiguration(
  target: SignalTarget | readonly SignalTarget[]
): void {
  const targets: readonly SignalTarget[] = typeof target === 'string' ? [target] : target
  if (targets.length === 0) {
    throw new Error('[target] At least one target is required.')
  }

  const supportedTargets = new Set<SignalTarget>([
    'tanstack-query',
    'swr',
    'rtk-query',
    'generic',
  ])
  const seen = new Set<SignalTarget>()
  for (const configuredTarget of targets) {
    if (!supportedTargets.has(configuredTarget)) {
      const validList = Array.from(supportedTargets).map(t => `'${t}'`).join(', ')
      throw new Error(
        `[target] Unsupported target: ${JSON.stringify(configuredTarget)}. ` +
        `Valid targets are: ${validList} (or use SIGNAL_TARGETS.TANSTACK_QUERY, SIGNAL_TARGETS.SWR, SIGNAL_TARGETS.RTK, SIGNAL_TARGETS.GENERIC).`
      )
    }
    if (seen.has(configuredTarget)) {
      throw new Error(`[target] Duplicate target: ${JSON.stringify(configuredTarget)}.`)
    }
    seen.add(configuredTarget)
  }
}

// ── Target signal validation ──────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInvalidateSignal(value: unknown): value is InvalidateSignal {
  if (!isRecord(value) || !isJSONValue(value)) return false

  const target = value.target
  if (target === 'tanstack-query') return isJSONValueArray(value.queryKey)
  if (target === 'swr') return typeof value.key === 'string' || isJSONValueArray(value.key)
  if (target === 'rtk-query') return Array.isArray(value.tags) && value.tags.every(isRTKTag)
  if (target !== undefined && target !== 'generic') return false
  return isJSONValueArray(value.key)
}

function isRTKTag(value: unknown): boolean {
  if (typeof value === 'string') return true
  if (!isRecord(value) || typeof value.type !== 'string') return false
  const id = value.id
  return id === undefined || typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))
}

function validateNonNegativeFinite(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value))) {
    throw new RangeError(`[createSSEChannel] ${name} must be a non-negative safe integer.`)
  }
}

function validateChannelOptions<TSignal extends InvalidateSignal>(options: SSEChannelOptions<TSignal>): void {
  validateNonNegativeFinite('eventBufferCapacity', options.eventBufferCapacity)
  validateNonNegativeFinite('retryIntervalMs', options.retryIntervalMs)
  if (
    options.keepaliveIntervalMs !== undefined &&
    (!Number.isFinite(options.keepaliveIntervalMs) || options.keepaliveIntervalMs < 0)
  ) {
    throw new RangeError('[createSSEChannel] keepaliveIntervalMs must be a non-negative finite number.')
  }
  if (options.lifetime === undefined) return

  const { ttlMs, deadline, onDeadline } = options.lifetime
  if (ttlMs !== undefined && deadline !== undefined) {
    throw new Error('[createSSEChannel] lifetime.ttlMs and lifetime.deadline are mutually exclusive.')
  }
  if (ttlMs === undefined && deadline === undefined) {
    throw new Error('[createSSEChannel] lifetime requires exactly one of ttlMs or deadline.')
  }
  validateNonNegativeFinite('lifetime.ttlMs', ttlMs)
  validateNonNegativeFinite('lifetime.deadline', deadline)
  if (typeof onDeadline === 'object') {
    validateNonNegativeFinite('lifetime.onDeadline.maxAttempts', onDeadline.maxAttempts)
    validateNonNegativeFinite('lifetime.onDeadline.retryDelayMs', onDeadline.retryDelayMs)
  }
}

export function validateSignalTargets<TSignal extends InvalidateSignal = InvalidateSignal>(
  signal: TSignal | TSignal[],
  targetConfig: SignalTarget | readonly SignalTarget[] | readonly string[]
): TSignal | TSignal[]
export function validateSignalTargets(
  signal: unknown,
  targetConfig: SignalTarget | readonly SignalTarget[] | readonly string[]
): InvalidateSignal | InvalidateSignal[]
export function validateSignalTargets(
  signal: unknown,
  targetConfig: SignalTarget | readonly SignalTarget[] | readonly string[]
): unknown {
  const signalList = Array.isArray(signal) ? signal : [signal]
  const declaredTargets: readonly string[] = typeof targetConfig === 'string' ? [targetConfig] : targetConfig
  const declaredSet = new Set<string>(declaredTargets)
  const coveredTargets = new Set<string>()
  const resultList: InvalidateSignal[] = []

  for (const s of signalList) {
    if (!isRecord(s)) {
      const sStr = typeof s === 'string' ? s : JSON.stringify(s)
      throw new Error(
        `[invalidate] Every signal must be an object. ` +
        `Got: ${sStr.slice(0, 200)}. ` +
        `Declared targets: [${declaredTargets.join(', ')}].`
      )
    }

    const targetStr = typeof s['target'] === 'string' ? s['target'] : ''

    if (targetStr === '') {
      if (declaredTargets.length === 1 && declaredTargets[0] !== undefined) {
        // Single-target channel: auto-fill target if omitted
        coveredTargets.add(declaredTargets[0])
        const filled = Object.assign({}, s, { target: declaredTargets[0] })
        if (!isInvalidateSignal(filled)) {
          throw new Error('[invalidate] Invalid signal structure.')
        }
        resultList.push(filled)
      } else {
        const sStr = JSON.stringify(s)
        throw new Error(
          `[invalidate] Multi-target channel requires an explicit "target" field on every signal. ` +
          `Got signal without target: ${sStr.slice(0, 200)}. ` +
          `Declared targets: [${declaredTargets.join(', ')}].`
        )
      }
    } else {
      if (!declaredSet.has(targetStr)) {
        throw new Error(
          `[invalidate] Signal target "${targetStr}" is not in the channel's declared targets: ` +
          `[${declaredTargets.join(', ')}].`
        )
      }
      if (!isInvalidateSignal(s)) {
        throw new Error('[invalidate] Invalid signal structure.')
      }
      coveredTargets.add(targetStr)
      resultList.push(s)
    }
  }

  if (declaredTargets.length > 1) {
    for (const t of declaredTargets) {
      if (!coveredTargets.has(t)) {
        throw new Error(
          `[invalidate] Multi-target channel requires signals for ALL declared targets. ` +
          `Missing target: "${t}". ` +
          `Declared: [${declaredTargets.join(', ')}], ` +
          `Provided: [${[...coveredTargets].join(', ')}].`
        )
      }
    }
  }

  if (Array.isArray(signal)) return resultList
  const first = resultList[0]
  if (first === undefined) {
    throw new Error('[invalidate] Signal validation produced no usable signal.')
  }
  return first
}

/** Validates the JSON-safe wire shape of one signal or a non-empty signal batch. */
export function validateSignalPayload(signal: unknown): void {
  const signalList = Array.isArray(signal) ? signal : [signal]
  if (signalList.length === 0 || !signalList.every(isInvalidateSignal)) {
    throw new Error('[invalidate] Signals must be non-empty JSON-safe invalidation objects.')
  }
}
