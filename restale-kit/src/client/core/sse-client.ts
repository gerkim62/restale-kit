import { isJSONValue, type UniversalSignal } from '@/types/protocol.js'
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
import { PROTOCOL_CONSTANTS, SSE_EVENTS, FRAME_GUARD_DEFAULTS } from '@/utils/constants.js'
import { SSE, type SSEvent } from 'sse.js'

/** Returns true if url is not a string or contains only whitespace / zero-width / BOM characters. */
export function isBlankUrl(url: unknown): boolean {
  if (typeof url !== 'string') return true
  return url.replace(/(?:\s|\u200B|\u200C|\u200D|\uFEFF)/gu, '') === ''
}

/** Reads a string property from an unknown object without any cast. */
function getStringProp(obj: object, key: string): string | undefined {
  if (!Object.hasOwn(obj, key)) return undefined
  const val: unknown = Reflect.get(obj, key)
  return typeof val === 'string' ? val : undefined
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
export class SSEInvalidatorClient extends EventTarget {
  private readonly url: string
  private readonly eventSourceUrl: string
  private readonly clientContextUrl: string
  private nativeAutoReconnect: boolean = PROTOCOL_CONSTANTS.DEFAULT_AUTO_RECONNECT
  private jsBackoffAutoReconnect: boolean = PROTOCOL_CONSTANTS.DEFAULT_AUTO_RECONNECT
  private maxRetries = PROTOCOL_CONSTANTS.DEFAULT_MAX_RETRIES
  private reconnectOptions: ClientOptions['reconnect']
  private readonly withCredentials: boolean
  private callback?: ClientOptions['callback']
  private onConnect?: ClientOptions['onConnect']
  private onDisconnect?: ClientOptions['onDisconnect']
  private onError?: ClientOptions['onError']
  private debug = false
  private currentConnectionId: string | undefined = undefined

  private opened = false
  private eventSource: SSE | null = null
  private currentStatus: ConnectionStatus = { status: 'closed', reason: 'manual' }
  private currentAttempt = 0
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

  constructor(url: string, opts?: ClientOptions) {
    super()
    
    // Gap 10: Validate URL - reject blank/whitespace strings
    if (isBlankUrl(url)) {
      throw new Error(
        '[SSEInvalidatorClient] url must be a non-empty, non-whitespace string. ' +
        `Got: ${JSON.stringify(url)}`
      )
    }

    if (opts?.reconnect) {
      calculateBackoff(0, opts.reconnect)
    }
    
    const clientContextUrl = opts?.clientContextUrl ?? url
    if (isBlankUrl(clientContextUrl)) {
      throw new Error(
        '[SSEInvalidatorClient] clientContextUrl must be a non-empty, non-whitespace string. ' +
        `Got: ${JSON.stringify(clientContextUrl)}`
      )
    }

    this.url = url
    this.eventSourceUrl = url
    this.clientContextUrl = clientContextUrl
    this.callback = opts?.callback
    this.onConnect = opts?.onConnect
    this.onDisconnect = opts?.onDisconnect
    this.onError = opts?.onError
    this.updateRuntimeOptions(opts)
    this.withCredentials = opts?.withCredentials ?? false

    if (this.debug) {
      console.log(
        `[restale-kit][SSEInvalidatorClient] Instantiated new client (endpoint: ${this.url})`
      )
    }
  }

  /** @internal Used by the React binding to apply changed hook props. */
  updateRuntimeOptions(
    opts?: Pick<
      ClientOptions,
      'autoReconnect' | 'reconnect' | 'debug' | 'callback' | 'onConnect' | 'onDisconnect' | 'onError'
    >
  ): void {
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
    this.debug = opts?.debug ?? false
    if (opts && Object.hasOwn(opts, 'callback')) this.callback = opts.callback
    if (opts && Object.hasOwn(opts, 'onConnect')) this.onConnect = opts.onConnect
    if (opts && Object.hasOwn(opts, 'onDisconnect')) this.onDisconnect = opts.onDisconnect
    if (opts && Object.hasOwn(opts, 'onError')) this.onError = opts.onError

    if (this.retryTimer !== null) {
      const canRetry = this.jsBackoffAutoReconnect || (this.opened && this.nativeAutoReconnect)
      if (!canRetry) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
        if (this.currentStatus.status === 'connecting') {
          this.setStatus({ status: 'closed', reason: 'manual' })
        }
      }
    }
  }

  /** The unique ID generated by the server for this SSE connection instance. */
  get connectionId(): string | undefined {
    return this.currentConnectionId
  }

  /** The URL this client connects to. */
  get endpointUrl(): string {
    return this.url
  }

  /** Current connection status. */
  get status(): ConnectionStatus {
    return this.currentStatus
  }

  /** Current reconnect attempt count (0 on initial connect or after success). */
  get attempt(): number {
    return this.currentAttempt
  }

  /** The last event ID string received from the SSE stream, if any. */
  get lastEventId(): string | null {
    return this.currentLastEventId
  }

  /** Sends client-supplied query-shaping context to the server for this connection. */
  async updateClientContext(
    clientContext: unknown,
    options?: { revision?: number }
  ): Promise<{ updated: boolean }> {
    if (!this.currentConnectionId) {
      throw new Error('[SSEInvalidatorClient.updateClientContext] Client is not connected.')
    }
    if (!isJSONValue(clientContext)) {
      throw new Error('[SSEInvalidatorClient.updateClientContext] clientContext must be a valid JSONValue.')
    }
    if (options?.revision !== undefined && (!Number.isSafeInteger(options.revision) || options.revision < 0)) {
      throw new Error('[SSEInvalidatorClient.updateClientContext] revision must be a non-negative safe integer.')
    }
    const response = await fetch(this.clientContextUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        purpose: 'CLIENT_CONTEXT',
        connectionId: this.currentConnectionId,
        clientContext,
        ...(options?.revision !== undefined ? { revision: options.revision } : {}),
      }),
      credentials: this.withCredentials ? 'include' : 'same-origin',
    })
    if (response.status === 204) return { updated: true }
    if (response.status === 404) return { updated: false }
    throw new Error(`[SSEInvalidatorClient.updateClientContext] Request failed with status ${String(response.status)}.`)
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
        `[restale-kit][SSEInvalidatorClient] connect() called (connectionId: ${this.currentConnectionId ?? 'none'}, currentStatus: ${this.currentStatus.status})`
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
    this.currentAttempt = 0
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
        `[restale-kit][SSEInvalidatorClient] close() called with reason: manual (connectionId: ${this.currentConnectionId ?? 'none'})`
      )
    }
    this.teardown()
    this.currentConnectionId = undefined
    this.currentLastEventId = null
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
  /** @internal Used by the React binding to distinguish unmount cleanup from `close()`. */
  closeWithUnmount(): void {
    if (this.debug) {
      console.log(
        `[restale-kit][SSEInvalidatorClient] closeWithUnmount() called with reason: unmount (connectionId: ${this.currentConnectionId ?? 'none'})`
      )
    }
    this.teardown()
    this.currentConnectionId = undefined
    this.currentLastEventId = null
    this.setStatus({ status: 'closed', reason: 'unmount' })
    if (this.connectPromise) {
      this.connectPromise.reject(new Event('close'))
      this.connectPromise = null
    }
  }

  // --- Typed addEventListener / removeEventListener overloads ---

  addEventListener<K extends keyof SSEInvalidatorClientEventMap>(
    type: K,
    listener: (
      this: SSEInvalidatorClient,
      ev: SSEInvalidatorClientEventMap[K]
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

  removeEventListener<K extends keyof SSEInvalidatorClientEventMap>(
    type: K,
    listener: (
      this: SSEInvalidatorClient,
      ev: SSEInvalidatorClientEventMap[K]
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
    this.currentConnectionId = undefined

    this.setStatus({ status: 'connecting' })

    if (this.debug) {
      const reason = this.currentAttempt === 0
        ? 'First connection attempt for this client instance'
        : `Automatic reconnection attempt ${String(this.currentAttempt)} after connection drop/error`
      console.log(
        `[restale-kit][SSEInvalidatorClient] Creating EventSource (connectionId: ${this.currentConnectionId ?? 'none'}). Reason: ${reason}.`
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

    es.onopen = (event: SSEvent) => {
      if (this.eventSource !== es) return
      if (!this.isValidHandshake(es, event)) {
        this.emitError(event)
        this.handleReconnectError(es, event)
        return
      }

      this.opened = true
      this.currentAttempt = 0
      this.setStatus({ status: 'open' })
      this.invokeUserCallback('onConnect', this.onConnect, event)
      if (this.debug) {
        console.log(
          `[restale-kit][SSEInvalidatorClient] EventSource opened successfully (connectionId: ${this.currentConnectionId ?? 'pending'}). Stream is live.`
        )
      }
      if (this.connectPromise && this.currentConnectionId !== undefined) {
        this.connectPromise.resolve()
        this.connectPromise = null
      }
    }

    es.onerror = (event: SSEvent) => {
      if (this.eventSource !== es) return
      this.emitError(event)
      this.handleReconnectError(es, event)
    }

    this.wireConnectedListener(es)
    this.wireInvalidateListener(es)
  }

  private wireConnectedListener(es: SSE): void {
    const currentEs = es
    es.addEventListener(SSE_EVENTS.CONNECTED, (event: MessageEvent<string>) => {
      if (this.eventSource !== currentEs) return
      let parsedId: string | undefined
      try {
        const parsed: unknown = JSON.parse(event.data)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const cid = getStringProp(parsed, 'connectionId')
          if (cid !== undefined) parsedId = cid
        }
      } catch {
        // malformed connected payload
      }

      if (parsedId !== undefined) {
        if (this.eventSource !== currentEs) return
        this.currentConnectionId = parsedId
        this.dispatchEvent(new CustomEvent(SSE_EVENTS.CONNECTED, { detail: { connectionId: parsedId } }))
        if (this.connectPromise && this.opened) {
          this.connectPromise.resolve()
          this.connectPromise = null
        }
      }
    })
  }

  /**
   * Handles transport errors, implementing status rejection and managed reconnect decisions.
   */
  private handleReconnectError(es: SSE, event: SSEvent): void {
    if (this.eventSource !== es) return

    const rejectedResponse = this.getRejectedResponse(es, event)
    if (rejectedResponse !== null) {
      this.invokeUserCallback('onDisconnect', this.onDisconnect, event)
      this.teardown()
      this.currentConnectionId = undefined
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
    this.invokeUserCallback('onDisconnect', this.onDisconnect, event)
    this.teardown()

    if (!this.revoked && !this.renewing && canRetry && this.currentAttempt < this.maxRetries) {
      const delay = retryAfterDelay ?? calculateBackoff(this.currentAttempt, this.reconnectOptions)
      if (this.debug) {
        console.log(
          `[restale-kit][SSEInvalidatorClient] Connection failed/closed (connectionId: ${this.currentConnectionId ?? 'none'}). ` +
          `Retrying in ${String(delay)}ms (attempt ${String(this.currentAttempt + 1)} of ${String(this.maxRetries)}).`
        )
      }
      this.currentAttempt++
      this.setStatus({ status: 'connecting' })
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        this.establishConnection()
      }, delay)
    } else {
      const exhaustedRetries = !this.revoked && !this.renewing && canRetry && this.currentAttempt >= this.maxRetries
      if (this.debug) {
        const reason = this.revoked
          ? 'Server sent terminal revoke frame'
          : this.renewing
          ? 'Renew confirmatory reconnect in progress'
          : !canRetry
          ? 'autoReconnect is disabled for this failure'
          : `Exhausted maxRetries (${String(this.maxRetries)})`
        console.log(
          `[restale-kit][SSEInvalidatorClient] Connection failed permanently (connectionId: ${this.currentConnectionId ?? 'none'}). Reason: ${reason}.`
        )
      }

      if (exhaustedRetries) {
        this.dispatchEvent(
          new CustomEvent(SSE_EVENTS.RETRIES_EXHAUSTED, {
            detail: { attempts: this.currentAttempt, maxRetries: this.maxRetries },
          })
        )
      }

      this.currentConnectionId = undefined
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
    this.currentConnectionId = undefined
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
      if (this.eventSource !== es) return
      let validated: UniversalSignal | UniversalSignal[] | undefined = undefined
      try {
        // Built-in structural validation
        validated = validatePayload(event.data)
        this.dispatchEvent(new CustomEvent(SSE_EVENTS.INVALIDATE, { detail: validated }))
        this.invokeUserCallback('callback', this.callback, validated)

        if (typeof event.lastEventId === 'string' && event.lastEventId !== '') {
          this.currentLastEventId = event.lastEventId
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        if (this.debug) {
          console.error(
            '[ERROR][wireInvalidateListener] Failed to process invalidate event',
            '\n  url:',
            this.url,
            '\n  attempt:',
            this.attempt,
            '\n  rawData:',
            (typeof event.data === 'string' ? event.data : JSON.stringify(event.data)).slice(0, 500),
            '\n  parsed:',
            validated ? JSON.stringify(validated, null, 2).slice(0, 500) : 'n/a',
            '\n  error:',
            error.stack || error.message
          )
        } else {
          console.error('[ERROR][wireInvalidateListener] Failed to process invalidate event:', error.message)
        }
        const message = error.message
        const detail = typeof ErrorEvent !== 'undefined' ? new ErrorEvent('error', { message }) : error
        this.emitError(detail)
      }
    })

    es.addEventListener(SSE_EVENTS.REVOKE, (event: MessageEvent<string>) => {
      let parsedReason: string | undefined
      try {
        const parsed: unknown = JSON.parse(event.data)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const reason = getStringProp(parsed, 'reason')
          if (reason !== undefined) parsedReason = reason
        }
      } catch {
        // malformed revoke payload — leave fields as undefined
      }

      // Mark revoked so onerror (which fires after the stream closes) does not retry.
      if (this.debug) {
        console.log(
          `[restale-kit][SSEInvalidatorClient] Revoke frame received (connectionId: ${this.currentConnectionId ?? 'none'}). Reason: Server revoked connection ("${parsedReason ?? 'unknown'}"). Auto-reconnect suppressed.`
        )
      }
      this.revoked = true
      this.teardown()
      this.currentConnectionId = undefined
      this.setStatus({ status: 'closed', reason: 'revoked' })

      if (this.connectPromise) {
        this.connectPromise.reject(new Event(SSE_EVENTS.REVOKE))
        this.connectPromise = null
      }

      const detail: RevokeEventDetail = { ...(parsedReason !== undefined ? { reason: parsedReason } : {}) }

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
            `(connectionId: ${this.currentConnectionId ?? 'none'}). Treating as revoke.`
          )
        }
        this.renewing = true
        this.teardown()
        this.hardRevokeDeadline()
        return
      }

      if (this.debug) {
        console.log(
          `[restale-kit][SSEInvalidatorClient] Renew frame received (connectionId: ${this.currentConnectionId ?? 'none'}). ` +
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
              `(connectionId: ${this.currentConnectionId ?? 'none'}).`
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
        this.currentConnectionId = undefined
        const renewEs = new SSE(this.eventSourceUrl, {
          withCredentials: this.withCredentials,
          headers: this.getReconnectHeaders(),
          autoReconnect: false,
          useLastEventId: false,
        })
        this.eventSource = renewEs

        renewEs.onopen = (event: SSEvent) => {
          if (!this.isValidHandshake(renewEs, event)) {
            this.emitError(event)
            renewEs.onopen = () => {}
            renewEs.onerror = () => {}
            onRenewError()
            return
          }
          // Re-wire full listeners (invalidate, revoke, renew) and then notify open.
          renewEs.onopen = () => {}
          renewEs.onerror = () => {}
          this.wireRenewSuccess(renewEs, event, onRenewOpen)
        }

        renewEs.onerror = () => {
          if (this.eventSource !== renewEs) return
          this.emitError(new Event('error'))
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
  private wireRenewSuccess(es: SSE, event: SSEvent, onOpenCallback: () => void): void {
    this.opened = true
    this.currentAttempt = 0
    this.setStatus({ status: 'open' })
    this.invokeUserCallback('onConnect', this.onConnect, event)
    onOpenCallback()

    if (this.connectPromise && this.currentConnectionId !== undefined) {
      this.connectPromise.resolve()
      this.connectPromise = null
    }

    // Re-wire the full listener set so subsequent frames are handled correctly.
    this.wireConnectedListener(es)
    this.wireInvalidateListener(es)

    // Wire onerror for mid-stream drops on the new connection.
    es.onerror = (event: SSEvent) => {
      this.emitError(event)
      this.handleReconnectError(es, event)
    }
  }

  /** Dispatches an error and then invokes the configured error callback safely. */
  private emitError(error: unknown): void {
    const detail = error instanceof Event
      ? error
      : typeof ErrorEvent !== 'undefined'
        ? new ErrorEvent('error', { message: error instanceof Error ? error.message : String(error) })
        : new Event('error')
    this.dispatchEvent(new CustomEvent('error', { detail }))
    this.invokeUserCallback('onError', this.onError, error)
  }

  /**
   * User callbacks are observers: an exception must not change connection state or
   * prevent other lifecycle work. Reporting through the console avoids recursively
   * invoking a failing `onError` callback.
   */
  private invokeUserCallback<T>(name: string, callback: ((value: T) => void) | undefined, value: T): void {
    if (!callback) return
    try {
      callback(value)
    } catch (error) {
      console.error(`[restale-kit][SSEInvalidatorClient] ${name} callback threw`, error)
    }
  }

  private getReconnectHeaders(): Record<string, string> {
    return this.currentLastEventId === null ? {} : { 'Last-Event-ID': this.currentLastEventId }
  }

  private getRejectedResponse(es: SSE, event: SSEvent): RejectedConnectionResponse | null {
    const status = event.responseCode ?? es.xhr?.status
    if (typeof status !== 'number' || !this.matchesNonRetryableStatus(status)) return null
    return { status, headers: event.headers ?? this.readResponseHeaders(es) }
  }

  /**
   * Validates that an incoming SSE connection handshake has a valid stream content-type.
   * A valid stream requires the Content-Type header to start with `text/event-stream`
   * (case-insensitive) when present.
   */
  private isValidHandshake(es: SSE, event?: SSEvent): boolean {
    const headers = event?.headers ?? this.readResponseHeaders(es)
    const contentType = this.getHeaderValue(headers, 'content-type')
    if (contentType !== undefined) {
      const normalized = contentType.trim().toLowerCase()
      if (!normalized.startsWith('text/event-stream')) {
        return false
      }
    }

    return true
  }

  private getHeaderValue(
    headers: Record<string, string | string[] | undefined>,
    headerName: string
  ): string | undefined {
    const targetKey = headerName.toLowerCase()
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === targetKey) {
        const val = headers[key]
        if (Array.isArray(val)) return val[0]
        if (typeof val === 'string') return val
      }
    }
    return undefined
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
    const headers = (event.headers ?? this.readResponseHeaders(es))
    const retryAfter = this.getHeaderValue(headers, 'retry-after')
    if (retryAfter === undefined) return undefined

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
    this.currentConnectionId = undefined
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
