import {
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
  isJSONValueArray,
} from '@/types/protocol.js'
import { isObject } from '@/pubsub/core/pubsub-utils.js'
import { SIGNAL_TARGETS } from '@/utils/constants.js'

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

const validTanStackActions: ReadonlySet<string> = new Set(TANSTACK_QUERY_ACTIONS)
const validSWRActions: ReadonlySet<string> = new Set(SWR_ACTIONS)
const validGenericActions: ReadonlySet<string> = new Set(GENERIC_ACTIONS)

function isTanStackQueryAction(val: unknown): val is TanStackQueryAction {
  return typeof val === 'string' && validTanStackActions.has(val)
}

function isSWRAction(val: unknown): val is SWRAction {
  return typeof val === 'string' && validSWRActions.has(val)
}

function isGenericAction(val: unknown): val is GenericAction {
  return typeof val === 'string' && validGenericActions.has(val)
}

function isSWRKey(val: unknown): val is string | JSONValue[] {
  return typeof val === 'string' || isJSONValueArray(val)
}

function isRTKTag(val: unknown): val is string | { type: string; id?: string | number } {
  if (typeof val === 'string') return true
  if (isObject(val) && typeof val.type === 'string') {
    const id = val.id
    return id === undefined || typeof id === 'string' || typeof id === 'number'
  }
  return false
}

function isRTKTags(val: unknown): val is RTKQuerySignal['tags'] {
  return Array.isArray(val) && val.every(isRTKTag)
}

function validateSingleSignal(value: unknown): ReStaleSignal {
  if (!isObject(value)) {
    throw new Error('Each signal must be a plain object')
  }

  const target = value.target

  if (target === SIGNAL_TARGETS.TANSTACK) {
    if (!('queryKey' in value) || !isJSONValueArray(value.queryKey)) {
      throw new Error('TanStack Query signal must have a "queryKey" property that is an array of JSON-serialisable values')
    }
    if ('exact' in value && typeof value.exact !== 'boolean') {
      throw new Error('Signal "exact" field must be a boolean')
    }
    if ('type' in value && (typeof value.type !== 'string' || (value.type !== 'active' && value.type !== 'inactive' && value.type !== 'all'))) {
      throw new Error('TanStack Query signal "type" field must be one of \'active\', \'inactive\', \'all\'')
    }
    if ('stale' in value && typeof value.stale !== 'boolean') {
      throw new Error('TanStack Query signal "stale" field must be a boolean')
    }
    if ('action' in value && !isTanStackQueryAction(value.action)) {
      throw new Error(`TanStack Query signal "action" field must be one of 'invalidate', 'refetch', 'reset', 'remove', 'cancel'`)
    }
    const signal: TanStackQuerySignal = {
      target: SIGNAL_TARGETS.TANSTACK,
      queryKey: value.queryKey,
    }
    if (typeof value.exact === 'boolean') signal.exact = value.exact
    if (typeof value.type === 'string' && (value.type === 'active' || value.type === 'inactive' || value.type === 'all')) {
      signal.type = value.type
    }
    if (isTanStackQueryAction(value.action)) {
      signal.action = value.action
    }
    if (typeof value.stale === 'boolean') signal.stale = value.stale
    return signal
  }

  if (target === SIGNAL_TARGETS.SWR) {
    if (!('key' in value) || !isSWRKey(value.key)) {
      throw new Error('SWR signal must have a "key" property that is a string or an array of JSON-serialisable values')
    }
    if ('action' in value && !isSWRAction(value.action)) {
      throw new Error(`SWR signal "action" field must be one of 'revalidate', 'purge', 'remove'`)
    }
    if ('match' in value && value.match !== 'exact' && value.match !== 'prefix') {
      throw new Error(`SWR signal "match" field must be 'exact' or 'prefix'`)
    }
    if ('revalidate' in value && typeof value.revalidate !== 'boolean') {
      throw new Error('SWR signal "revalidate" field must be a boolean')
    }
    const signal: SWRSignal = {
      target: SIGNAL_TARGETS.SWR,
      key: value.key,
    }
    if (isSWRAction(value.action)) {
      signal.action = value.action
    }
    if (typeof value.revalidate === 'boolean') signal.revalidate = value.revalidate
    if (value.match === 'exact' || value.match === 'prefix') signal.match = value.match
    return signal
  }

  if (target === SIGNAL_TARGETS.RTK) {
    if (!('tags' in value) || !isRTKTags(value.tags)) {
      throw new Error('RTK Query signal "tags" property must be an array of strings or tag objects')
    }
    const signal: RTKQuerySignal = {
      target: SIGNAL_TARGETS.RTK,
      tags: value.tags,
    }
    return signal
  }

  if ('target' in value && value.target !== undefined && value.target !== SIGNAL_TARGETS.GENERIC) {
    const targetStr = typeof value.target === 'string' ? value.target : JSON.stringify(value.target)
    throw new Error(`Signal "target" field must be 'generic' when present on generic signals — got '${targetStr}'`)
  }

  // Generic or default signal format
  if (!('key' in value) || !isJSONValueArray(value.key)) {
    throw new Error('Signal must have a "key" property that is an array of JSON-serialisable values')
  }

  if ('exact' in value && typeof value.exact !== 'boolean') {
    throw new Error('Signal "exact" field must be a boolean')
  }

  if ('action' in value && !isGenericAction(value.action)) {
    const actionStr = typeof value.action === 'string' ? value.action : JSON.stringify(value.action)
    throw new Error(`Signal "action" field must be one of 'invalidate', 'refetch', 'remove' — got '${actionStr}'`)
  }

  const signal: GenericInvalidateSignal = { key: value.key }
  if (target === SIGNAL_TARGETS.GENERIC) signal.target = SIGNAL_TARGETS.GENERIC
  if (typeof value.exact === 'boolean') signal.exact = value.exact
  if (isGenericAction(value.action)) {
    signal.action = value.action
  }
  return signal
}

