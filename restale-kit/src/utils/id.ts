import crypto from 'node:crypto'

/**
 * Generates a cryptographically strong UUID (v4) using Node's `crypto.randomUUID()`.
 */
export function generateUUID(): string {
  return crypto.randomUUID()
}

/**
 * Generates a collision-resistant instance ID for pub/sub self-echo suppression.
 */
export function generateInstanceId(): string {
  return crypto.randomUUID()
}

