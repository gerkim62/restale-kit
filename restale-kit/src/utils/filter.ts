/**
 * Universal Filter Types
 */

export type LocalFilter<TMeta> =
  | true
  | ((meta: TMeta | undefined) => boolean)
  | Partial<TMeta>

export type ClusterFilter<TMeta> =
  | true
  | Partial<TMeta>

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Performs deep subset matching:
 * - Primitives match strictly (===).
 * - Objects match if every expected property matches the actual property.
 * - Arrays match via order-independent element containment (every expected element has a match in actual).
 */
export function deepSubsetMatch(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true

  if (expected === null || expected === undefined) {
    return actual === expected
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false
    return expected.every((expItem) =>
      actual.some((actItem) => deepSubsetMatch(actItem, expItem)),
    )
  }

  if (isPlainRecord(expected)) {
    if (!isPlainRecord(actual)) return false
    return Object.entries(expected).every(([key, expValue]) => {
      if (expValue === undefined) return true
      return deepSubsetMatch(actual[key], expValue)
    })
  }

  return false
}

/**
 * Evaluates a LocalFilter against channel metadata.
 * Throws TypeError if filter is undefined, false, null, or invalid.
 */
export function matchesLocalFilter<TMeta>(
  meta: TMeta | undefined,
  filter: LocalFilter<TMeta>,
): boolean {
  if (filter === true) return true

  if (typeof filter === 'boolean' || filter === undefined || filter === null) {
    throw new TypeError(
      '[matchesLocalFilter] filter is required and must be true, a predicate function, or a criteria object. Omitting the filter or passing false is strictly disallowed.',
    )
  }

  if (typeof filter === 'function') {
    return filter(meta)
  }

  if (typeof filter === 'object') {
    return deepSubsetMatch(meta, filter)
  }

  throw new TypeError(
    '[matchesLocalFilter] filter must be true, a predicate function, or a criteria object.',
  )
}

/**
 * Evaluates a ClusterFilter against channel metadata.
 * Throws TypeError if filter is a function (predicates cannot be serialized across cluster),
 * undefined, false, null, or invalid.
 */
export function matchesClusterFilter<TMeta = unknown>(
  meta: TMeta | undefined,
  filter: ClusterFilter<TMeta> | Record<string, unknown>,
): boolean {
  if (filter === true) return true

  if (typeof filter === 'function') {
    throw new TypeError(
      '[matchesClusterFilter] ClusterFilter does not support predicate functions because they cannot be serialized across nodes. Use true or an object criteria.',
    )
  }

  if (typeof filter === 'boolean' || filter === undefined || filter === null) {
    throw new TypeError(
      '[matchesClusterFilter] filter is required and must be true or a criteria object. Omitting the filter or passing false is strictly disallowed.',
    )
  }

  if (typeof filter === 'object') {
    return deepSubsetMatch(meta, filter)
  }

  throw new TypeError(
    '[matchesClusterFilter] filter must be true or a criteria object.',
  )
}
