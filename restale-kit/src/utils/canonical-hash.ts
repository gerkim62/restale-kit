function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deterministically serializes any JSON-compatible value into a canonical string.
 * Object keys are sorted alphabetically at every level.
 * Whitespace and key-ordering differences are eliminated.
 */
export function canonicalJsonSerialize(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (value === null) return 'null'

  const type = typeof value
  if (type === 'number' || type === 'boolean' || type === 'string') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalJsonSerialize(item) ?? 'null')
    return `[${items.join(',')}]`
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    const entries: string[] = []
    for (const key of keys) {
      const val = value[key]
      if (val !== undefined) {
        const serializedVal = canonicalJsonSerialize(val)
        if (serializedVal !== undefined) {
          entries.push(`${JSON.stringify(key)}:${serializedVal}`)
        }
      }
    }
    return `{${entries.join(',')}}`
  }

  return undefined
}

/**
 * Fast 32-bit FNV-1a hash algorithm returning an 8-character hex string.
 */
function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Computes a deterministic canonical hash string for a client context value.
 * Returns undefined if context is undefined or not serializable.
 */
export function computeContextHash(context: unknown): string | undefined {
  if (context === undefined) return undefined
  const serialized = canonicalJsonSerialize(context)
  if (serialized === undefined) return undefined
  return fnv1a32Hex(serialized)
}
