import type { StandardSchemaV1 } from './standard-schema.js'

/**
 * Thrown when `invalidate()` is called on a channel that has already been closed.
 *
 * This is intentionally an error rather than a silent no-op — a dropped signal
 * means the client's cache is now silently wrong. The caller should know.
 */
export class ChannelClosedError extends Error {
  readonly name = 'ChannelClosedError' as const

  constructor() {
    super('Cannot send on a closed channel')
  }
}

/**
 * Thrown when a signal or metadata value fails Standard Schema validation.
 *
 * Contains both a formatted `message` string and the original `issues` array
 * for programmatic access.
 */
export class SchemaValidationError extends Error {
  readonly name = 'SchemaValidationError' as const
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>

  constructor(issues: ReadonlyArray<StandardSchemaV1.Issue>) {
    const formatted = issues
      .map((issue) => {
        const path = issue.path
          ? issue.path
              .map((p) => (typeof p === 'object' ? String(p.key) : String(p)))
              .join('.')
          : undefined
        return path ? `${path}: ${issue.message}` : issue.message
      })
      .join('; ')

    super(`Schema validation failed: ${formatted}`)
    this.issues = issues
  }
}
