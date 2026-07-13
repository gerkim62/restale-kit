import type { ReconnectOptions } from '@/client/core/client-contracts.js'

const DEFAULT_BASE_DELAY_MS = 1_000
const DEFAULT_MAX_DELAY_MS = 30_000
const DEFAULT_JITTER = true

/**
 * Calculates the backoff delay for a given attempt number.
 *
 * Formula: `min(baseDelayMs × 2^attempt, maxDelayMs)`
 * When jitter is enabled: `delay × random(0.5, 1.5)`
 *
 * @param attempt - Zero-indexed attempt number. Resets to 0 on successful open.
 * @param options - Reconnect configuration.
 * @returns Delay in milliseconds before the next retry.
 */
export function calculateBackoff(attempt: number, options?: ReconnectOptions): number {
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const jitter = options?.jitter ?? DEFAULT_JITTER

  let delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)

  if (jitter) {
    // random(0.5, 1.5) — prevents thundering herd
    delay = delay * (0.5 + Math.random())
  }

  return delay
}
