import type { InvalidateSignal } from '@/types/protocol.js'
import { type StandardSchemaV1, validateStandardSchema } from '@/types/standard-schema.js'
import type {
  ConnectionStatus,
  ClientOptions,
  SSEInvalidatorClientEventMap,
} from '@/client/core/client-contracts.js'
import { validatePayload } from '@/client/core/validation.js'
import { calculateBackoff } from '@/client/core/backoff.js'
import { SchemaValidationError } from '@/types/errors.js'
import { generateUUID } from '@/utils/id.js'
import { appendQueryParam } from '@/utils/url.js'
import { PROTOCOL_CONSTANTS, SSE_EVENTS } from '@/utils/constants.js'


/**
 * Client-side SSE invalidation client built on native `EventSource`.
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
  private readonly signalSchema?: StandardSchemaV1<unknown, TSignal>
  private readonly withCredentials: boolean
  private readonly debug: boolean
  private readonly currentConnectionId: string

  private opened = false
  private eventSource: EventSource | null = null
  private currentStatus: ConnectionStatus = { status: 'closed', reason: 'manual' }
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private revoked = false
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
    this.eventSourceUrl = appendQueryParam(
      url,
      PROTOCOL_CONSTANTS.RESTALE_REQUEST_ID_PARAM,
      this.currentConnectionId
    )
    const autoReconnectOpt = opts?.autoReconnect
    if (typeof autoReconnectOpt === 'object' && autoReconnectOpt !== null) {
      this.nativeAutoReconnect = autoReconnectOpt.native ?? PROTOCOL_CONSTANTS.DEFAULT_AUTO_RECONNECT
      this.jsBackoffAutoReconnect = autoReconnectOpt.jsBackoff ?? PROTOCOL_CONSTANTS.DEFAULT_AUTO_RECONNECT
    } else {
      const isAuto = autoReconnectOpt ?? PROTOCOL_CONSTANTS.DEFAULT_AUTO_RECONNECT
      this.nativeAutoReconnect = isAuto
      this.jsBackoffAutoReconnect = isAuto
    }
    this.maxRetries = opts?.reconnect?.maxRetries ?? PROTOCOL_CONSTANTS.DEFAULT_MAX_RETRIES
    this.reconnectOptions = opts?.reconnect
    this.signalSchema = opts?.signalSchema
    this.withCredentials = opts?.withCredentials ?? false
    this.debug = opts?.debug ?? false

    if (this.debug) {
      console.log(
        `[restale-kit][SSEInvalidatorClient] Instantiated new client (connectionId: ${String(this.currentConnectionId)}) for URL: ${this.eventSourceUrl}`
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
        `[restale-kit][SSEInvalidatorClient] connect() called (connectionId: ${String(this.currentConnectionId)}, currentStatus: ${this.currentStatus.status})`
      )
    }

    // Already open — no-op
    if (this.currentStatus.status === 'open') {
      return Promise.resolve()
    }

    // Already connecting and actively establishing socket (not waiting on retry timer) — return same pending promise
    if (this.currentStatus.status === 'connecting' && this.connectPromise && this.retryTimer === null) {
      return this.connectPromise.promise
    }

    // Cancel any pending retry timer
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    // Reset backoff counter and revoked flag for a fresh connect attempt
    this.attempt = 0
    this.revoked = false

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
        `[restale-kit][SSEInvalidatorClient] close() called with reason: manual (connectionId: ${String(this.currentConnectionId)})`
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
        `[restale-kit][SSEInvalidatorClient] closeWithUnmount() called with reason: unmount (connectionId: ${String(this.currentConnectionId)})`
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
    const existingPromise = this.connectPromise
    this.opened = false

    this.setStatus({ status: 'connecting' })

    if (this.debug) {
      const reason = this.attempt === 0
        ? 'First connection attempt for this client instance'
        : `Automatic reconnection attempt ${String(this.attempt)} after connection drop/error`
      console.log(
        `[restale-kit][SSEInvalidatorClient] Creating EventSource (connectionId: ${String(this.currentConnectionId)}). Reason: ${reason}. URL: ${this.eventSourceUrl}`
      )
    }

    const es = new EventSource(this.eventSourceUrl, { withCredentials: this.withCredentials })
    this.eventSource = es

    es.onopen = () => {
      this.opened = true
      this.attempt = 0 // Reset on successful open
      this.setStatus({ status: 'open' })
      if (this.debug) {
        console.log(
          `[restale-kit][SSEInvalidatorClient] EventSource opened successfully (connectionId: ${String(this.currentConnectionId)}). Stream is live.`
        )
      }
      if (existingPromise) {
        existingPromise.resolve()
        if (this.connectPromise === existingPromise) {
          this.connectPromise = null
        }
      }
    }

    es.onerror = (event: Event) => {
      this.dispatchEvent(new CustomEvent('error', { detail: event }))

      if (this.eventSource !== es) {
        return
      }

      if (this.opened && this.nativeAutoReconnect && es.readyState === EventSource.CONNECTING) {
        if (this.debug) {
          console.log(
            `[restale-kit][SSEInvalidatorClient] Connection interrupted mid-stream (connectionId: ${String(this.currentConnectionId)}). Reason: Network drop or temporary server disruption. Native EventSource is auto-reconnecting (readyState: CONNECTING).`
          )
        }
        // Connection was established and dropped mid-stream (temporary network drop).
        // Native EventSource is actively auto-reconnecting on the same instance (readyState === CONNECTING),
        // preserving native Last-Event-ID HTTP headers.
        this.setStatus({ status: 'connecting' })
        return
      }

      // Initial connection failure or fatal response (e.g. HTTP 500/502/503 where readyState === CLOSED),
      // OR mid-stream drop when nativeAutoReconnect is false:
      // Native EventSource will not auto-reconnect. Fall back to JS backoff retries.
      this.teardown()

      if (!this.revoked && this.jsBackoffAutoReconnect && this.attempt < this.maxRetries) {
        const delay = calculateBackoff(this.attempt, this.reconnectOptions)
        if (this.debug) {
          console.log(
            `[restale-kit][SSEInvalidatorClient] Connection failed/closed (connectionId: ${String(this.currentConnectionId)}, readyState: ${String(es.readyState)}). Reason: EventSource error. Retrying in ${String(delay)}ms (attempt ${String(this.attempt + 1)} of ${String(this.maxRetries)}).`
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
            : !this.jsBackoffAutoReconnect
            ? 'jsBackoff autoReconnect is disabled'
            : `Exhausted maxRetries (${String(this.maxRetries)})`
          console.log(
            `[restale-kit][SSEInvalidatorClient] Connection failed permanently (connectionId: ${String(this.currentConnectionId)}). Reason: ${reason}.`
          )
        }
        this.setStatus({ status: 'error', error: event })
        if (existingPromise) {
          existingPromise.reject(event)
          if (this.connectPromise === existingPromise) {
            this.connectPromise = null
          }
        }
      }
    }

    this.wireInvalidateListener(es)
  }

  /**
   * Wires the `invalidate` and `revoke` event listeners on an EventSource instance.
   * Runs the validation pipeline (steps 1–7) and emits either `invalidate` or `error`.
   * On `revoke`, suppresses auto-reconnect and transitions to `{ status: 'closed', reason: 'revoked' }`.
   */
  private wireInvalidateListener(es: EventSource): void {
    es.addEventListener(SSE_EVENTS.INVALIDATE, (event: MessageEvent<string>) => {
      let validated: InvalidateSignal | InvalidateSignal[] | undefined = undefined
      try {
        // Steps 1–6: structural validation
        validated = validatePayload(event.data)

        // Step 7: optional schema validation
        if (this.signalSchema) {
          const signals = Array.isArray(validated) ? validated : [validated]
          const results: TSignal[] = []

          for (const signal of signals) {
            const value = validateStandardSchema(signal, this.signalSchema)
            results.push(value)
          }

          // Step 8: emit validated, typed payload
          const payload = Array.isArray(validated) ? results : results[0]
          this.dispatchEvent(new CustomEvent(SSE_EVENTS.INVALIDATE, { detail: payload }))
        } else {
          // No schema — emit as-is after structural validation
          this.dispatchEvent(new CustomEvent(SSE_EVENTS.INVALIDATE, { detail: validated }))
        }

        if (typeof event.lastEventId === 'string' && event.lastEventId !== '') {
          this.currentLastEventId = event.lastEventId
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        const issues = err instanceof SchemaValidationError ? err.issues : undefined
        // The raw incoming event payload that failed validation or processing
        console.error(
          "[ERROR][wireInvalidateListener] Failed to process invalidate event",
          "\n  url:", this.url,
          "\n  attempt:", this.attempt,
          "\n  rawData:", (typeof event.data === "string" ? event.data : JSON.stringify(event.data)).slice(0, 500),
          "\n  parsed:", validated ? JSON.stringify(validated, null, 2).slice(0, 500) : "n/a",
          ...(issues ? ["\n  schemaIssues:", JSON.stringify(issues, null, 2)] : []),
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
      let reason = 'revoked'
      try {
        const parsed: unknown = JSON.parse(event.data)
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          'reason' in parsed
        ) {
          const { reason: parsedReason } = parsed
          if (typeof parsedReason === 'string') {
            reason = parsedReason
          }
        }
      } catch {
        // malformed revoke payload — use default reason
      }

      // Mark revoked so onerror (which fires after the stream closes) does not retry.
      if (this.debug) {
        console.log(
          `[restale-kit][SSEInvalidatorClient] Revoke frame received (connectionId: ${String(this.currentConnectionId)}). Reason: Server revoked connection ("${reason}"). Auto-reconnect suppressed.`
        )
      }
      this.revoked = true
      this.teardown()
      const status: ConnectionStatus = { status: 'closed', reason: 'revoked' }
      this.setStatus(status)

      if (this.connectPromise) {
        this.connectPromise.reject(new Event(SSE_EVENTS.REVOKE))
        this.connectPromise = null
      }

      this.dispatchEvent(new CustomEvent(SSE_EVENTS.REVOKE, { detail: { reason } }))
    })
  }

  private setStatus(newStatus: ConnectionStatus): void {
    this.currentStatus = newStatus
    this.dispatchEvent(new CustomEvent('statuschange', { detail: newStatus }))
  }

  private teardown(): void {
    this.opened = false
    if (this.eventSource) {
      this.eventSource.onopen = null
      this.eventSource.onerror = null
      this.eventSource.close()
      this.eventSource = null
    }

    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }
}
