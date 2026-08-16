// Source - https://stackoverflow.com/a/48161723
// Posted by Vitaly Zdanevich, modified by community. See post 'Timeline' for change history
// Retrieved 2026-08-16, License - CC BY-SA 4.0

export async function sha256(message: string): Promise<string> {
  // encode as UTF-8
  const msgBuffer = new TextEncoder().encode(message)

  // hash the message
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)

  // convert ArrayBuffer to Array
  const hashArray = Array.from(new Uint8Array(hashBuffer))

  // convert bytes to hex string
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasToJSON(value: unknown): value is { toJSON: () => unknown } {
  return typeof value === 'object' && value !== null && 'toJSON' in value && typeof value.toJSON === 'function'
}

/**
 * Deterministically serializes any JSON-compatible value into a canonical string.
 * Object keys are sorted alphabetically at every level.
 * Whitespace and key-ordering differences are eliminated.
 */
export function canonicalJsonSerialize(value: unknown): string | undefined {
  const activePath = new Set<object>()
  let encounteredCycle = false

  const serialize = (current: unknown): string | undefined => {
    if (current === undefined) return undefined
    if (current === null) return 'null'

    const type = typeof current
    if (type === 'number' || type === 'boolean' || type === 'string') {
      return JSON.stringify(current)
    }

    if (hasToJSON(current)) {
      try {
        return serialize(current.toJSON())
      } catch {
        return undefined
      }
    }

    if (Array.isArray(current) || isPlainObject(current)) {
      if (activePath.has(current)) {
        encounteredCycle = true
        return undefined
      }

      activePath.add(current)
      try {
        if (Array.isArray(current)) {
          const items = current.map((item) => serialize(item) ?? 'null')
          return encounteredCycle ? undefined : `[${items.join(',')}]`
        }

        const keys = Object.keys(current).sort()
        const entries: string[] = []
        for (const key of keys) {
          const val = current[key]
          if (val !== undefined) {
            const serializedVal = serialize(val)
            if (serializedVal !== undefined) {
              entries.push(`${JSON.stringify(key)}:${serializedVal}`)
            }
          }
        }
        return encounteredCycle ? undefined : `{${entries.join(',')}}`
      } finally {
        activePath.delete(current)
      }
    }

    return undefined
  }

  return serialize(value)
}

/**
 * Computes a secure deterministic sender hash for connection self-exclusion.
 */
export async function computeSenderHash(connectionId: string): Promise<string> {
  return sha256(connectionId)
}

/**
 * Computes a deterministic canonical hash string for a client context value.
 * Returns undefined if context is undefined or not serializable.
 */
export async function computeContextHash(context: unknown): Promise<string | undefined> {
  if (context === undefined) return undefined
  const serialized = canonicalJsonSerialize(context)
  if (serialized === undefined) return undefined
  return sha256(serialized)
}
