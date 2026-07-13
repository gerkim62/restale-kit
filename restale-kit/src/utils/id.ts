/**
 * Generates a cryptographically strong UUID (v4) with secure fallback for legacy environments
 * lacking native `crypto.randomUUID()`.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (
      Number(c) ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
    ).toString(16)
  )
}

/**
 * Generates a short, collision-resistant instance ID for pub/sub self-echo suppression.
 */
export function generateInstanceId(): string {
  return Math.random().toString(36).slice(2)
}
