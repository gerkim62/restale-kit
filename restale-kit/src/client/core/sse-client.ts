import type { InvalidateSignal } from '@/types/protocol.js'
import { type StandardSchemaV1, validateStandardSchema } from '@/types/standard-schema.js'
import type {
  ConnectionStatus,
  ClientOptions,
  SSEInvalidatorClientEventMap,
  RevokeEventDetail,
  RenewEventDetail,
  RejectedConnectionResponse,
  HttpStatusMatcher,
} from '@/client/core/client-contracts.js'
import { validatePayload } from '@/client/core/validation.js'
import { calculateBackoff } from '@/client/core/backoff.js'
import { SchemaValidationError } from '@/types/errors.js'
import { generateUUID } from '@/utils/id.js'
import { appendQueryParam } from '@/utils/url.js'
import { PROTOCOL_CONSTANTS, SSE_EVENTS, FRAME_GUARD_DEFAULTS } from '@/utils/constants.js'
import { SSE, type SSEvent } from 'sse.js'

/** Reads a string property from an unknown object without any cast. */
function getStringProp(obj: object, key: string): string | undefined {
  if (!Object.hasOwn(obj, key)) return undefined
  const val: unknown = Reflect.get(obj, key)
  return typeof val === 'string' ? val : undefined
}

/** Reads an array property from an unknown object without any cast. */
function getArrayProp(obj: object, key: string): unknown[] | undefined {
  if (!Object.hasOwn(obj, key)) return undefined
  const val: unknown = Reflect.get(obj, key)
  return Array.isArray(val) ? val : undefined
}

/** Reads a number property from an unknown object without any cast. */
function getNumberProp(obj: object, key: string): number | undefined {
  if (!Object.hasOwn(obj, key)) return undefined
  const val: unknown = Reflect.get(obj, key)
  return typeof val === 'number' ? val : undefined
}

function isStatusMatcherList(
  value: HttpStatusMatcher | readonly HttpStatusMatcher[]
): value is readonly HttpStatusMatcher[] {
  return Array.isArray(value)
}


/**
 * Client-side SSE invalidation client built on `sse.js`.
 *
 * Framework-agnostic — emits typed events for connection status changes and
 * invalidation signals. UI framework wrappers (e.g., `restale-kit/react`)
 * subscribe to these events.
 *
 * Supports automatic reconnection with exponential backoff, and optional
 * Standard Schema validation of incoming payloads.
 */
export class SSEInvalidatorClient<
  TSignal extends InvalidateSignal = InvalidateSignal,
> extends EventTarget {
  private readonly url: string
  private readonly eventSourceUrl: string
  private readonly nativeAutoReconnect: boolean
  private readonly jsBackoffAutoReconnect: boolean
  private readonly maxRetries: number
  private readonly reconnectOptions: ClientOptions<TSignal>['reconnect']
  private readonly withCredentials: boolean
  private readonly debug: boolean
  private readonly currentConnectionId: string

  private opened = false
  private eventSource: SSE | null = null
  private currentStatus: ConnectionStatus = { status: 'closed', reason: 'manual' }
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private revoked = false
  private renewing = false
  private renewRetryTimer: ReturnType<typeof setTimeout> | null = null
  private connectPromise: {
    promise: Promise<void>
    resolve: () => void
    reject: (error: Event) => void
  } | null = null
  private currentLastEventId: string | null = null

  constructor(url: string, opts?: ClientOptions<TSignal>) {
    super()
    this.currentConnectionId = generateUUID()
    this.url = url
    let eventSourceUrl = appendQueryParam(
      url,
      PROTOCOL_CONSTANTS.RESTALE_REQUEST_ID_PARAM,
      this.currentConnectionId
    )
    if (opts?.target !== undefined) {
      eventSourceUrl = appendQueryParam(
        eventSourceUrl,
        PROTOCOL_CONSTANTS.RESTALE_TARGET_PARAM,
        opts.target
      )
    }
    this.eventSourceUrl = eventSourceUrl
    const autoReconnectOpt = opts?.autoReconnect
    if (typeof autoReconnectOpt === 'object') {
      this.nativeAutoReconnect = autoReconnectOpt.native ?? PROTOCOL_CONSTANTS.DEFAULT_AUTO_RECONNECT
      this.jsBackoffAutoReconnect = autoReconnectOpt.jsBackoff ?? PROTOCOL_CONSTANTS.DEFAULT_AUTO_RECONNECT
    } else {
      const isAuto = autoReconnectOpt ?? PROTOCOL_CONSTANTS.DEFAULT_AUTO_RECONNECT
      this.nativeAutoReconnect = isAuto
      this.jsBackoffAutoReconnect = isAuto
    }
    this.maxRetries = opts?.reconnect?.maxRetries ?? PROTOCOL_CONSTANTS.DEFAULT_MAX_RETRIES
    this.reconnectOptions = opts?.reconnect
    this.withCredentials = opts?.withCredentials ?? false
    this.debug = opts?.debug ?? false

    if (this.debug) {
      console.log(
        `[restale-kit][SSEInvalidatorClient] Instantiated new client (connectionId: ${this.currentConnectionId})`
      )
    }
  }

  /** The unique ID generated for this SSE connection instance. */
  get connectionId(): string {
    return this.currentConnectionId
  }

  /** The URL this client connects to (excluding the injected `__restale_cid__` parameter). */
  get endpointUrl(): string {
    return this.url
  }

  /** Current connection status. */
  get status(): ConnectionStatus {
    return this.currentStatus
  }

  /** The last event ID string received from the SSE stream, if any. */
  get lastEventId(): string | null {
    return this.currentLastEventId
  }

  /**
   * Opens the SSE connection.
   *
   * | Current state | Behavior |
   * |---|---|
   * | `'open'` | No-op, returns resolved promise |
   * | `'connecting'` | Returns the same pending promise |
   * | `'closed'` | Creates new EventSource, resets backoff |
   * | `'error'` | Cancels pending retry, creates new EventSource, resets backoff |
   */
  connect(): Promise<void> {
    if (this.debug) {
      console.log(
        `[restale-kit][SSEInvalidatorClient] connect() called (connectionId: ${this.currentConnectionId}, currentStatus: ${this.currentStatus.status})`
      )
    }

    // Already open — no-op
    if (this.currentStatus.status === 'open') {
      return Promise.resolve()
    }

    // Already connecting — handle an active stream attempt or pending connect promise.
    if (this.currentStatus.status === 'connecting') {
      if (this.eventSource && this.eventSource.readyState === SSE.CONNECTING) {
        if (!this.connectPromise) {
          let resolveConnect: () => void = () => {}
          let rejectConnect: (error: Event) => void = () => {}
          const promise = new Promise<void>((res, rej) => {
            resolveConnect = res
            rejectConnect = rej
          })
          this.connectPromise = { promise, resolve: resolveConnect, reject: rejectConnect }
        }
        return this.connectPromise.promise
      }

      if (this.connectPromise && this.retryTimer === null) {
        return this.connectPromise.promise
      }
    }

    // Cancel any pending retry timer
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    // Reset backoff counter and revoked flag for a fresh connect attempt
    this.attempt = 0
    this.revoked = false
    this.renewing = false

    return this.createConnection()
  }

  /**
   * Closes the connection with reason `'manual'`.
   *
   * Cancels any pending retry timer. `connect()` can reopen the connection.
   */
  close(): void {
    if (this.debug) {
      console.log(
        `[restale-kit][SSEInvalidatorClient] close() called with reason: manual (connectionId: ${this.currentConnectionId})`
      )
    }
    this.teardown()
    this.setStatus({ status: 'closed', reason: 'manual' })

    // Reject any pending connect promise so callers aren't left dangling
    if (this.connectPromise) {
      this.connectPromise.reject(new Event('close'))
      this.connectPromise = null
    }
  }

  /**
   * Closes the connection with reason `'unmount'`.
   * Called by the React hook on component unmount.
   * Behaves identically to `close()` but the resulting status reason is `'unmount'`
   * instead of `'manual'`, matching the documented contract.
   */
  closeWithUnmount(): void {
    if (this.debug) {
      console.log(
        `[restale-kit][SSEInvalidatorClient] closeWithUnmount() called with reason: unmount (connectionId: ${this.currentConnectionId})`
      )
    }
    this.teardown()
    this.setStatus({ status: 'closed', reason: 'unmount' })
    if (this.connectPromise) {
      this.connectPromise.reject(new Event('close'))
      this.connectPromise = null
    }
  }

  // --- Typed addEventListener / removeEventListener overloads ---

  addEventListener<K extends keyof SSEInvalidatorClientEventMap<TSignal>>(
    type: K,
    listener: (
      this: SSEInvalidatorClient<TSignal>,
      ev: SSEInvalidatorClientEventMap<TSignal>[K]
    ) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    super.addEventListener(type, listener, options)
  }

  removeEventListener<K extends keyof SSEInvalidatorClientEventMap<TSignal>>(
    type: K,
    listener: (
      this: SSEInvalidatorClient<TSignal>,
      ev: SSEInvalidatorClientEventMap<TSignal>[K]
    ) => void,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    super.removeEventListener(type, listener, options)
  }

  // --- Private ---

  private createConnection(): Promise<void> {
    // Build connect promise. The executor runs synchronously, so resolve and
    // reject are always assigned before the Promise constructor returns.
    let resolveConnect: () => void = () => {}
    let rejectConnect: (error: Event) => void = () => {}

    const promise = new Promise<void>((res, rej) => {
      resolveConnect = res
      rejectConnect = rej
    })

    this.connectPromise = { promise, resolve: resolveConnect, reject: rejectConnect }

    this.establishConnection()

    return promise
  }

  /**
   * Establishes the connection and handles retries / promise resolution.
   */
  private establishConnection(): void {
    this.opened = false

    this.setStatus({ status: 'connecting' })

    if (this.debug) {
      const reason = this.attempt === 0
        ? 'First connection attempt for this client instance'
        : `Automatic reconnection attempt ${String(this.attempt)} after connection drop/error`
      console.log(
        `[restale-kit][SSEInvalidatorClient] Creating EventSource (connectionId: ${this.currentConnectionId}). Reason: ${reason}.`
      )
    }

    const es = new SSE(this.eventSourceUrl, {
      withCredentials: this.withCredentials,
      headers: this.getReconnectHeaders(),
      // Keep retry ownership here so each attempt can inspect its HTTP result and
      // retain our retry budget and status-classification lifecycle.
      autoReconnect: false,
      useLastEventId: false,
    })
    this.eventSource = es

    es.onopen = () => {
      this.opened = true
      this.attempt = 0 // Reset on successful open
      this.setStatus({ status: 'open' })
      if (this.debug) {
        console.log(
          `[restale-kit][SSEInvalidatorClient] EventSource opened successfully (connectionId: ${this.currentConnectionId}). Stream is live.`
        )
      }
      if (this.connectPromise) {
        this.connectPromise.resolve()
        this.connectPromise = null
      }
    }

    es.onerror = (event: SSEvent) => {
      this.dispatchEvent(new CustomEvent('error', { detail: event}))
      this.handleReconnectError(es, event)
    }

    this.wireInvalidateListener(es)
  }

  /**
   * Handles transport errors, implementing status rejection and managed reconnect decisions.
   */
  private handleReconnectError(es: SSE, event: SSEvent): void {
    if (this.eventSource !== es) return

    const rejectedResponse = this.getRejectedResponse(es, event)
    if (rejectedResponse !== null) {
      this.teardown()
      this.setStatus({ status: 'closed', reason: 'rejected', response: rejectedResponse })
      this.dispatchEvent(new CustomEvent('rejected', { detail: rejectedResponse }))
      if (this.connectPromise) {
        this.connectPromise.reject(event)
        this.connectPromise = null
      }
      return
    }

    // sse.js's own retry loop is disabled. Preserve the former `native` option's
    // mid-stream behaviour while keeping retry budgeting under this client.
    const canRetry = this.jsBackoffAutoReconnect || (this.opened && this.nativeAutoReconnect)
    const retryAfterDelay = this.reconnectOptions?.retryAfter === 'respect'
      ? this.getRetryAfterDelay(es, event)
      : undefined
    this.teardown()

    if (!this.revoked && !this.renewing && canRetry && this.attempt < this.maxRetries) {
      const delay = retryAfterDelay ?? calculateBackoff(this.attempt, this.reconnectOptions)
      if (this.debug) {
        console.log(
          `[restale-kit][SSEInvalidatorClient] Connection failed/closed (connectionId: ${this.currentConnectionId}). ` +
          `Retrying in ${String(delay)}ms (attempt ${String(this.attempt + 1)} of ${String(this.maxRetries)}).`
        )
      }
      this.attempt++
      this.setStatus({ status: 'connecting' })
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        this.establishConnection()
      }, delay)
    } else {
      if (this.debug) {
        const reason = this.revoked
          ? 'Server sent terminal revoke frame'
          : this.renewing
          ? 'Renew confirmatory reconnect in progress'
          : !canRetry
          ? 'autoReconnect is disabled for this failure'
          : `Exhausted maxRetries (${String(this.maxRetries)})`
        console.log(
          `[restale-kit][SSEInvalidatorClient] Connection failed permanently (connectionId: ${this.currentConnectionId}). Reason: ${reason}.`
        )
      }
      this.setStatus({ status: 'error', error: event })
      if (this.connectPromise) {
        this.connectPromise.reject(event)
        this.connectPromise = null
      }
    }
  }

  /**
   * Handles hard revocation when deadline-related reconnect attempts fail or are invalid.
   * Clears renewing state, marks as revoked, dispatches revoke event with reason 'deadline',
   * rejects pending connect promise, and sets status to closed.
   */
  private hardRevokeDeadline(): void {
    this.renewing = false
    this.revoked = true
    this.setStatus({ status: 'closed', reason: 'revoked' })
    const detail: RevokeEventDetail = { reason: 'deadline' }
    this.dispatchEvent(new CustomEvent(SSE_EVENTS.REVOKE, { detail }))
    if (this.connectPromise) {
      this.connectPromise.reject(new Event(SSE_EVENTS.RENEW))
      this.connectPromise = null
    }
  }

  /**
   * Wires the `invalidate` and `revoke` event listeners on an EventSource instance.
   * Runs the validation pipeline (steps 1–7) and emits either `invalidate` or `error`.
   * On `revoke`, suppresses auto-reconnect and transitions to `{ status: 'closed', reason: 'revoked' }`.
   */
  private wireInvalidateListener(es: SSE): void {
    es.addEventListener(SSE_EVENTS.INVALIDATE, (event: MessageEvent<string>) => {
      let validated: InvalidateSignal | InvalidateSignal[] | undefined = undefined
      try {
        // Built-in structural validation
        validated = validatePayload(event.data)
        this.dispatchEvent(new CustomEvent(SSE_EVENTS.INVALIDATE, { detail: validated }))

        if (typeof event.lastEventId === 'string' && event.lastEventId !== '') {
          this.currentLastEventId = event.lastEventId
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        // The raw incoming event payload that failed validation or processing
        console.error(
          "[ERROR][wireInvalidateListener] Failed to process invalidate event",
          "\n  url:", this.url,
          "\n  attempt:", this.attempt,
          "\n  rawData:", (typeof event.data === "string" ? event.data : JSON.stringify(event.data)).slice(0, 500),
          "\n  parsed:", validated ? JSON.stringify(validated, null, 2).slice(0, 500) : "n/a",
          "\n  error:", error.stack || error.message
        )
        const message = error.message
        const detail = typeof ErrorEvent !== 'undefined' ? new ErrorEvent('error', { message }) : error
        this.dispatchEvent(
          new CustomEvent('error', { detail })
        )
      }
    })

    es.addEventListener(SSE_EVENTS.REVOKE, (event: MessageEvent<string>) => {
      let parsedReason: string | undefined
      let parsedRequested: string | undefined
      let parsedSupported: string[] | undefined
      try {
        const parsed: unknown = JSON.parse(event.data)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const reason = getStringProp(parsed, 'reason')
          const requested = getStringProp(parsed, 'requested')
          const supportedRaw = getArrayProp(parsed, 'supported')
          if (reason !== undefined) parsedReason = reason
          if (requested !== undefined) parsedRequested = requested
          if (supportedRaw !== undefined) {
            const strings = supportedRaw.filter((s): s is string => typeof s === 'string')
            if (strings.length === supportedRaw.length) parsedSupported = strings
          }
        }
      } catch {
        // malformed revoke payload — leave fields as undefined
      }

      // Mark revoked so onerror (which fires after the stream closes) does not retry.
      if (this.debug) {
        if (parsedReason === 'unsupported-target' && parsedRequested !== undefined) {
          console.warn(
            `[WARN][SSEInvalidatorClient] Connection revoked: requested "${parsedRequested}", supported [${parsedSupported?.join(', ') ?? ''}]. Auto-reconnect suppressed. connectionId: ${this.currentConnectionId}.`
          )
        } else {
          console.log(
            `[restale-kit][SSEInvalidatorClient] Revoke frame received (connectionId: ${this.currentConnectionId}). Reason: Server revoked connection ("${parsedReason ?? 'unknown'}"). Auto-reconnect suppressed.`
          )
        }
      }
      this.revoked = true
      this.teardown()
      this.setStatus({ status: 'closed', reason: 'revoked' })

      if (this.connectPromise) {
        this.connectPromise.reject(new Event(SSE_EVENTS.REVOKE))
        this.connectPromise = null
      }

      // Build a properly-typed discriminated RevokeEventDetail
      const detail: RevokeEventDetail =
        parsedReason === 'unsupported-target' &&
        parsedRequested !== undefined &&
        parsedSupported !== undefined
          ? { reason: 'unsupported-target', requested: parsedRequested, supported: parsedSupported }
          : { reason: parsedReason }

      this.dispatchEvent(new CustomEvent(SSE_EVENTS.REVOKE, { detail }))
    })

    es.addEventListener(SSE_EVENTS.RENEW, (event: MessageEvent<string>) => {
      // Parse the renew payload — maxAttempts and retryDelayMs are STRICTLY server-supplied.
      // The spec (§4.1.2) states: "The client holds no independent default and performs no
      // local override — maxAttempts is read from the frame the server sent for that deadline
      // hit, full stop." If the frame is malformed or maxAttempts is missing/invalid, the
      // client cannot proceed with any confirmatory attempt — treat as a hard revoke.
      let maxAttempts: number | undefined
      let retryDelayMs = 0 // safe neutral: "may be omitted when maxAttempts is 1" (§4.1.5)
      let parseOk = false
      try {
        const parsed: unknown = JSON.parse(event.data)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const ma: unknown = getNumberProp(parsed, 'maxAttempts')
          const rd: unknown = getNumberProp(parsed, 'retryDelayMs')
          // maxAttempts must be a positive finite integer supplied by the server — no floor/default.
          if (typeof ma === 'number' && Number.isFinite(ma) && ma >= 1) {
            maxAttempts = Math.floor(ma)
            parseOk = true
          }
          // retryDelayMs is optional (irrelevant when maxAttempts=1); default to 0 if absent.
          if (typeof rd === 'number' && Number.isFinite(rd) && rd >= 0) retryDelayMs = Math.floor(rd)
        }
      } catch {
        // malformed renew payload — parseOk stays false
      }

      // If the frame did not supply a valid maxAttempts the client has no basis to act.
      // Treat as a hard revoke per the spirit of §4.1.2 (cannot make a confirmatory attempt
      // of unknown count). Suppress general backoff via renewing=true during teardown.
      if (!parseOk || maxAttempts === undefined) {
        if (this.debug) {
          console.warn(
            `[restale-kit][SSEInvalidatorClient] Renew frame missing valid maxAttempts ` +
            `(connectionId: ${this.currentConnectionId}). Treating as revoke.`
          )
        }
        this.renewing = true
        this.teardown()
        this.hardRevokeDeadline()
        return
      }

      if (this.debug) {
        console.log(
          `[restale-kit][SSEInvalidatorClient] Renew frame received (connectionId: ${this.currentConnectionId}). ` +
          `Deadline reached — making up to ${String(maxAttempts)} confirmatory reconnect attempt(s).`
        )
      }

      // Suppress the generic onerror backoff path for the duration of renew handling.
      this.renewing = true
      this.teardown()
      this.setStatus({ status: 'connecting' })

      // Emit the renew event so integrators can observe it (optional — reconnect proceeds regardless).
      const renewDetail: RenewEventDetail = { reason: 'deadline', maxAttempts, retryDelayMs }
      this.dispatchEvent(new CustomEvent(SSE_EVENTS.RENEW, { detail: renewDetail }))

      // Start the confirmatory reconnect sequence. Each attempt is a fresh establishConnection()
      // call — it reuses the same EventSource URL (which carries Last-Event-ID in the header
      // automatically), so replay works through the existing eventStore path.
      let attemptsRemaining = maxAttempts
      const attemptRenewReconnect = (): void => {
        // Note: The unreachable attemptsRemaining <= 0 check here was removed as it can never
        // trigger at the start of attemptRenewReconnect - exhaustion is handled in onRenewError.

        attemptsRemaining--

        // Wire a one-shot open handler: if the connection succeeds, clear renewing state
        // so everything returns to normal. If it errors, schedule the next attempt.
        const onRenewOpen = (): void => {
          // Successful reconnect — renew cycle complete, resume normal operation.
          this.renewing = false
          if (this.debug) {
            console.log(
              `[restale-kit][SSEInvalidatorClient] Renew confirmatory reconnect succeeded ` +
              `(connectionId: ${this.currentConnectionId}).`
            )
          }
        }

        const onRenewError = (): void => {
          if (this.eventSource === null) return  // already torn down

          this.teardown()

          if (attemptsRemaining <= 0) {
            // No more attempts — terminal failure.
            this.hardRevokeDeadline()
            return
          }

          // More attempts remain — apply fixed delay with ±20% jitter (spec §4.1.5).
          const jitter = retryDelayMs * FRAME_GUARD_DEFAULTS.RENEW_JITTER_FACTOR
          const delay = retryDelayMs + (Math.random() * 2 - 1) * jitter
          this.setStatus({ status: 'connecting' })
          this.renewRetryTimer = setTimeout(() => {
            this.renewRetryTimer = null
            attemptRenewReconnect()
          }, Math.max(0, delay))
        }

        // Use the same EventSource URL — the browser will attach Last-Event-ID automatically.
        const renewEs = new SSE(this.eventSourceUrl, {
          withCredentials: this.withCredentials,
          headers: this.getReconnectHeaders(),
          autoReconnect: false,
          useLastEventId: false,
        })
        this.eventSource = renewEs

        renewEs.onopen = () => {
          // Re-wire full listeners (invalidate, revoke, renew) and then notify open.
          renewEs.onopen = () => {}
          renewEs.onerror = () => {}
          this.wireRenewSuccess(renewEs, onRenewOpen)
        }

        renewEs.onerror = () => {
          if (this.eventSource !== renewEs) return
          renewEs.onopen = () => {}
          renewEs.onerror = () => {}
          onRenewError()
        }
      }

      // Kick off the first attempt immediately (no initial delay — spec §4.1.2).
      attemptRenewReconnect()
    })
  }

  /**
   * After a successful renew confirmatory reconnect, re-wires the full event listeners
   * (invalidate, revoke, renew) on the newly opened EventSource and transitions to `open`.
   */
  private wireRenewSuccess(es: SSE, onOpenCallback: () => void): void {
    this.opened = true
    this.attempt = 0
    this.setStatus({ status: 'open' })
    onOpenCallback()

    if (this.connectPromise) {
      this.connectPromise.resolve()
      this.connectPromise = null
    }

    // Re-wire the full listener set so subsequent frames are handled correctly.
    this.wireInvalidateListener(es)

    // Wire onerror for mid-stream drops on the new connection.
    es.onerror = (event: SSEvent) => {
      this.dispatchEvent(new CustomEvent('error', { detail: event }))
      this.handleReconnectError(es, event)
    }
  }

  private getReconnectHeaders(): Record<string, string> {
    return this.currentLastEventId === null ? {} : { 'Last-Event-ID': this.currentLastEventId }
  }

  private getRejectedResponse(es: SSE, event: SSEvent): RejectedConnectionResponse | null {
    const status = event.responseCode
    if (typeof status !== 'number' || !this.matchesNonRetryableStatus(status)) return null
    return { status, headers: event.headers ?? this.readResponseHeaders(es) }
  }

  private readResponseHeaders(es: SSE): Record<string, string[]> {
    try {
      const raw = es.xhr?.getAllResponseHeaders()
      if (!raw) return {}
      return raw.trim().split(/\r?\n/).reduce<Record<string, string[]>>((headers, line) => {
        const separator = line.indexOf(':')
        if (separator < 0) return headers
        const name = line.slice(0, separator).trim().toLowerCase()
        const value = line.slice(separator + 1).trim()
        if (name !== '') (headers[name] ??= []).push(value)
        return headers
      }, {})
    } catch {
      // Browsers can withhold cross-origin response headers unless they are exposed.
      return {}
    }
  }

  private getRetryAfterDelay(es: SSE, event: SSEvent): number | undefined {
    const headers: Partial<Record<string, string[]>> = event.headers ?? this.readResponseHeaders(es)
    const retryAfter = headers['retry-after']?.[0]
    if (retryAfter == undefined) return undefined

    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1_000)

    const date = Date.parse(retryAfter)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
    return undefined
  }

  private matchesNonRetryableStatus(status: number): boolean {
    const configured = this.reconnectOptions?.nonRetryableStatuses
    if (configured === undefined) return false
    const matchers: readonly HttpStatusMatcher[] = isStatusMatcherList(configured)
      ? configured
      : [configured]
    return matchers.some((matcher) => this.matchesStatusMatcher(status, matcher))
  }

  private matchesStatusMatcher(status: number, matcher: HttpStatusMatcher): boolean {
    if (typeof matcher === 'number') return status === matcher
    if (typeof matcher === 'string') return Math.floor(status / 100) === Number.parseInt(matcher, 10)
    return status >= matcher.from && status <= matcher.to
  }

  private setStatus(newStatus: ConnectionStatus): void {
    this.currentStatus = newStatus
    this.dispatchEvent(new CustomEvent('statuschange', { detail: newStatus }))
  }

  private teardown(): void {
    this.opened = false
    if (this.eventSource) {
      this.eventSource.onopen = () => {}
      this.eventSource.onerror = () => {}
      this.eventSource.close()
      this.eventSource = null
    }

    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    if (this.renewRetryTimer !== null) {
      clearTimeout(this.renewRetryTimer)
      this.renewRetryTimer = null
    }
  }
}
