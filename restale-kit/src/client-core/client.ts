import type { InvalidateSignal } from '../shared/types.js'
import { type StandardSchemaV1, validateStandardSchema } from '../shared/standard-schema.js'
import type {
  ConnectionStatus,
  ClientOptions,
  SSEInvalidatorClientEventMap,
} from './types.js'
import { validatePayload } from './validation.js'
import { calculateBackoff } from './backoff.js'
import { SchemaValidationError } from '../shared/errors.js'

const DEFAULT_AUTO_RECONNECT = true
const DEFAULT_MAX_RETRIES = Infinity

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
  private readonly autoReconnect: boolean
  private readonly maxRetries: number
  private readonly reconnectOptions: ClientOptions<TSignal>['reconnect']
  private readonly signalSchema?: StandardSchemaV1<unknown, TSignal>

  private eventSource: EventSource | null = null
  private currentStatus: ConnectionStatus = { status: 'closed', reason: 'manual' }
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private connectPromise: {
    promise: Promise<void>
    resolve: () => void
    reject: (error: Event) => void
  } | null = null

  constructor(url: string, opts?: ClientOptions<TSignal>) {
    super()
    this.url = url
    this.autoReconnect = opts?.autoReconnect ?? DEFAULT_AUTO_RECONNECT
    this.maxRetries = opts?.reconnect?.maxRetries ?? DEFAULT_MAX_RETRIES
    this.reconnectOptions = opts?.reconnect
    this.signalSchema = opts?.signalSchema
  }

  /** Current connection status. */
  get status(): ConnectionStatus {
    return this.currentStatus
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
    // Already open — no-op
    if (this.currentStatus.status === 'open') {
      return Promise.resolve()
    }

    // Already connecting — return same pending promise
    if (this.currentStatus.status === 'connecting' && this.connectPromise) {
      return this.connectPromise.promise
    }

    // Cancel any pending retry timer
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    // Reset backoff counter for a fresh connect attempt
    this.attempt = 0

    return this.createConnection()
  }

  /**
   * Closes the connection with reason `'manual'`.
   *
   * Cancels any pending retry timer. `connect()` can reopen the connection.
   */
  close(): void {
    this.teardown()
    this.setStatus({ status: 'closed', reason: 'manual' })

    // Reject any pending connect promise so it doesn't dangle
    if (this.connectPromise) {
      // The connect() promise listeners are removed — just clean up
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

    this.setStatus({ status: 'connecting' })

    const es = new EventSource(this.url)
    this.eventSource = es

    es.onopen = () => {
      this.attempt = 0 // Reset on successful open
      this.setStatus({ status: 'open' })
      if (existingPromise) {
        existingPromise.resolve()
        if (this.connectPromise === existingPromise) {
          this.connectPromise = null
        }
      }
    }

    es.onerror = (event: Event) => {
      this.teardown()
      this.dispatchEvent(new CustomEvent('error', { detail: event }))

      if (this.autoReconnect && this.attempt < this.maxRetries) {
        const delay = calculateBackoff(this.attempt, this.reconnectOptions)
        this.attempt++
        this.setStatus({ status: 'connecting' })
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null
          this.establishConnection()
        }, delay)
      } else {
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
   * Wires the `invalidate` event listener on an EventSource instance.
   * Runs the validation pipeline (steps 1–7) and emits either `invalidate` or `error`.
   */
  private wireInvalidateListener(es: EventSource): void {
    es.addEventListener('invalidate', (event: MessageEvent<string>) => {
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
          this.dispatchEvent(new CustomEvent('invalidate', { detail: payload }))
        } else {
          // No schema — emit as-is after structural validation
          this.dispatchEvent(new CustomEvent('invalidate', { detail: validated }))
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
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: new ErrorEvent('error', { message }),
          })
        )
      }
    })
  }

  private setStatus(newStatus: ConnectionStatus): void {
    this.currentStatus = newStatus
    this.dispatchEvent(new CustomEvent('statuschange', { detail: newStatus }))
  }

  private teardown(): void {
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
