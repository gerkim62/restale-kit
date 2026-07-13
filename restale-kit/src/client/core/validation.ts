import type { InvalidateSignal, JSONValue } from '../../types/protocol.js'

/**
 * Validates an incoming SSE payload against the built-in structural rules.
 *
 * This implements steps 1–6 from the spec's validation pipeline:
 * 1. JSON.parse must succeed
 * 2. Result must be a plain object or array of plain objects
 * 3. Each object must have a `key` property that is an Array
 * 4. If `exact` is present, it must be boolean
 * 5. If `action` is present, it must be one of 'invalidate' | 'refetch' | 'remove'
 * 6. Extra unknown fields are ignored (forward-compatible)
 *
 * Returns the validated signal(s) or throws an Error with a descriptive message.
 */
export function validatePayload(data: string): InvalidateSignal | InvalidateSignal[] {
  // Step 1: JSON.parse
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    // The raw string payload from the SSE connection that failed JSON parsing
    console.error(
      "[ERROR][validatePayload] Failed to parse SSE payload as JSON",
      "\n  rawData:", data.slice(0, 500),
      "\n  error:", error.stack || error.message
    )
    throw new Error(`Failed to parse SSE payload as JSON: ${error.message}`, { cause: err })
  }

  // Step 2: Must be a plain object or array of plain objects
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new Error('SSE payload array must not be empty')
    }
    return parsed.map(validateSingleSignal)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('SSE payload must be a plain object or array of plain objects')
  }

  return validateSingleSignal(parsed)
}

type ValidAction = InvalidateSignal['action']

/** Type predicate: value is one of the three valid action strings. */
function isValidAction(value: unknown): value is ValidAction {
  return value === 'invalidate' || value === 'refetch' || value === 'remove'
}

/** Type guard: value is a non-null plain object (not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard: value is a JSONValue.
 * JSON.parse output always satisfies this, but we verify to satisfy the type system.
 */
function isJSONValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (Array.isArray(value)) {
    return value.every(isJSONValue)
  }
  if (typeof value === 'object') {
    return Object.values(value).every(isJSONValue)
  }
  return false
}

function validateSingleSignal(value: unknown): InvalidateSignal {
  if (!isPlainObject(value)) {
    throw new Error('Each signal must be a plain object')
  }

  // Step 3: Must have a `key` property that is an Array of JSONValues
  if (!('key' in value) || !Array.isArray(value.key) || !value.key.every(isJSONValue)) {
    throw new Error('Signal must have a "key" property that is an array of JSON-serialisable values')
  }
  const key: JSONValue[] = value.key

  // Step 4: If `exact` is present, it must be boolean
  if ('exact' in value && typeof value.exact !== 'boolean') {
    throw new Error('Signal "exact" field must be a boolean')
  }

  // Step 5: If `action` is present, it must be one of the valid values
  if ('action' in value && !isValidAction(value.action)) {
    const actionStr = typeof value.action === 'string' ? value.action : JSON.stringify(value.action)
    throw new Error(
      `Signal "action" field must be one of 'invalidate', 'refetch', 'remove' — got '${actionStr}'`
    )
  }

  // Step 6: Extra unknown fields are ignored — forward-compatible
  const signal: InvalidateSignal = { key }
  if (typeof value.exact === 'boolean') {
    signal.exact = value.exact
  }
  if (isValidAction(value.action)) {
    signal.action = value.action
  }
  return signal
}
