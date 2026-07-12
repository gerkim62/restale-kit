import type { InvalidateSignal } from '../core/types.js'

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
  } catch {
    throw new Error('Failed to parse SSE payload as JSON')
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

const VALID_ACTIONS = new Set(['invalidate', 'refetch', 'remove'])

function validateSingleSignal(value: unknown): InvalidateSignal {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Each signal must be a plain object')
  }

  const obj = value as Record<string, unknown>

  // Step 3: Must have a `key` property that is an Array
  if (!('key' in obj) || !Array.isArray(obj.key)) {
    throw new Error('Signal must have a "key" property that is an array')
  }

  // Step 4: If `exact` is present, it must be boolean
  if ('exact' in obj && typeof obj.exact !== 'boolean') {
    throw new Error('Signal "exact" field must be a boolean')
  }

  // Step 5: If `action` is present, it must be one of the valid values
  if ('action' in obj && !VALID_ACTIONS.has(obj.action as string)) {
    throw new Error(
      `Signal "action" field must be one of 'invalidate', 'refetch', 'remove' — got '${String(obj.action)}'`
    )
  }

  // Step 6: Extra unknown fields are ignored — forward-compatible
  return {
    key: obj.key,
    ...(obj.exact !== undefined && { exact: obj.exact as boolean }),
    ...(obj.action !== undefined && { action: obj.action as InvalidateSignal['action'] }),
  }
}
