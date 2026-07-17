import {
  type InvalidateSignal,
  type JSONValue,
  type ReStaleSignal,
  type TanStackQuerySignal,
  type SWRSignal,
  type RTKQuerySignal,
  type GenericInvalidateSignal,
  type TanStackQueryAction,
  type SWRAction,
  type GenericAction,
  TANSTACK_QUERY_ACTIONS,
  SWR_ACTIONS,
  GENERIC_ACTIONS,
} from '@/types/protocol.js'

/**
 * Validates an incoming SSE payload against the built-in structural rules.
 *
 * Supports discriminated signals (`target: 'tanstack-query'`, `target: 'swr'`, `target: 'rtk-query'`, `target: 'generic'`)
 * as well as legacy/generic key-based signals.
 */
export function validatePayload(data: unknown): ReStaleSignal | ReStaleSignal[] {
  // Step 1: JSON.parse if data is a string
  let parsed: unknown = data
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.error(
        "[ERROR][validatePayload] Failed to parse SSE payload as JSON",
        "\n  rawData:", data.slice(0, 500),
        "\n  error:", error.stack || error.message
      )
      throw new Error(`Failed to parse SSE payload as JSON: ${error.message}`, { cause: err })
    }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJSONValue(value: unknown): value is JSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isJSONValue)
  }
  if (typeof value === 'object') {
    return Object.values(value).every(isJSONValue)
  }
  return false
}

const validTanStackActions: ReadonlySet<string> = new Set(TANSTACK_QUERY_ACTIONS)

const validSWRActions: ReadonlySet<string> = new Set(SWR_ACTIONS)

const validGenericActions: ReadonlySet<string> = new Set(GENERIC_ACTIONS)


function validateSingleSignal(value: unknown): ReStaleSignal {
  if (!isPlainObject(value)) {
    throw new Error('Each signal must be a plain object')
  }

  const target = value.target

  if (target === 'tanstack-query') {
    if (!('queryKey' in value) || !Array.isArray(value.queryKey) || !value.queryKey.every(isJSONValue)) {
      throw new Error('TanStack Query signal must have a "queryKey" property that is an array of JSON-serialisable values')
    }
    if ('exact' in value && typeof value.exact !== 'boolean') {
      throw new Error('Signal "exact" field must be a boolean')
    }
    if ('type' in value && typeof value.type !== 'string') {
      throw new Error('TanStack Query signal "type" field must be a string')
    }
    if ('action' in value && (typeof value.action !== 'string' || !validTanStackActions.has(value.action))) {
      throw new Error(`TanStack Query signal "action" field must be one of 'invalidate', 'refetch', 'reset', 'remove', 'cancel'`)
    }
    const signal: TanStackQuerySignal = {
      target: 'tanstack-query',
      queryKey: value.queryKey,
    }
    if (typeof value.exact === 'boolean') signal.exact = value.exact
    if (typeof value.type === 'string' && (value.type === 'active' || value.type === 'inactive' || value.type === 'all')) {
      signal.type = value.type
    }
    if (typeof value.action === 'string' && validTanStackActions.has(value.action)) {
      signal.action = value.action as TanStackQueryAction
    }
    if (typeof value.stale === 'boolean') signal.stale = value.stale
    return signal
  }

  if (target === 'swr') {
    const hasValidKey =
      ('key' in value) &&
      (typeof value.key === 'string' || (Array.isArray(value.key) && value.key.every(isJSONValue)))
    if (!hasValidKey) {
      throw new Error('SWR signal must have a "key" property that is a string or an array of JSON-serialisable values')
    }
    if ('action' in value && (typeof value.action !== 'string' || !validSWRActions.has(value.action))) {
      throw new Error(`SWR signal "action" field must be one of 'revalidate', 'purge'`)
    }
    if ('match' in value && value.match !== 'exact' && value.match !== 'prefix') {
      throw new Error(`SWR signal "match" field must be 'exact' or 'prefix'`)
    }
    const signal: SWRSignal = {
      target: 'swr',
      key: value.key as string | JSONValue[],
    }
    if (typeof value.action === 'string' && validSWRActions.has(value.action)) {
      signal.action = value.action as SWRAction
    }
    if (typeof value.revalidate === 'boolean') signal.revalidate = value.revalidate
    if (value.match === 'exact' || value.match === 'prefix') signal.match = value.match
    return signal
  }

  if (target === 'rtk-query') {
    if (!('tags' in value) || !Array.isArray(value.tags)) {
      throw new Error('RTK Query signal must have a "tags" property that is an array')
    }
    const signal: RTKQuerySignal = {
      target: 'rtk-query',
      tags: value.tags as RTKQuerySignal['tags'],
    }
    return signal
  }

  // Generic or default signal format
  if (!('key' in value) || !Array.isArray(value.key) || !value.key.every(isJSONValue)) {
    throw new Error('Signal must have a "key" property that is an array of JSON-serialisable values')
  }

  if ('exact' in value && typeof value.exact !== 'boolean') {
    throw new Error('Signal "exact" field must be a boolean')
  }

  if ('action' in value && (typeof value.action !== 'string' || !validGenericActions.has(value.action))) {
    const actionStr = typeof value.action === 'string' ? value.action : JSON.stringify(value.action)
    throw new Error(`Signal "action" field must be one of 'invalidate', 'refetch', 'remove' — got '${actionStr}'`)
  }

  const signal: GenericInvalidateSignal = { key: value.key }
  if (target === 'generic') signal.target = 'generic'
  if (typeof value.exact === 'boolean') signal.exact = value.exact
  if (typeof value.action === 'string' && validGenericActions.has(value.action)) {
    signal.action = value.action as GenericInvalidateSignal['action']
  }
  return signal
}

