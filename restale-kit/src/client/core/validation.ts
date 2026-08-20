import {
  isJSONValue,
  isCacheKey,
  type Signal,
} from '@/types/protocol.js'
import { isObject } from '@/pubsub/core/pubsub-utils.js'

/** Validates the signal shape used by SSE invalidate frames. */
export function validatePayload(data: unknown): Signal | Signal[] {
  let parsed = data
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new Error(`Failed to parse SSE payload as JSON: ${message}`, { cause })
    }
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error('SSE payload array must not be empty')
    return parsed.map(validateSingleSignal)
  }
  return validateSingleSignal(parsed)
}

function validateSingleSignal(value: unknown): Signal {
  if (!isObject(value)) throw new Error('Each signal must be a plain object')
  if (!('key' in value) || !isCacheKey(value.key)) {
    throw new Error('Signal must have a "key" property that is an array of JSON-serialisable values')
  }

  const hasInlineData = 'inlineData' in value
  if (hasInlineData) {
    const unsupported = Object.keys(value).filter((key) => key !== 'key' && key !== 'inlineData' && key !== 'markStale')
    if (unsupported.length > 0) {
      throw new Error(`Inline-data signals contain unsupported fields: ${unsupported.join(', ')}`)
    }
    if (!isJSONValue(value.inlineData)) throw new Error('Signal "inlineData" field must be JSON-serialisable')
    if ('markStale' in value && typeof value.markStale !== 'boolean') {
      throw new Error('Signal "markStale" field must be a boolean')
    }
    return {
      key: value.key,
      inlineData: value.inlineData,
      ...(typeof value.markStale === 'boolean' ? { markStale: value.markStale } : {}),
    }
  }

  const unsupported = Object.keys(value).filter((key) => key !== 'key' && key !== 'exact')
  if (unsupported.length > 0) {
    throw new Error(`Revalidate signals contain unsupported fields: ${unsupported.join(', ')}`)
  }
  if ('exact' in value && typeof value.exact !== 'boolean') {
    throw new Error('Signal "exact" field must be a boolean')
  }
  return {
    key: value.key,
    ...(typeof value.exact === 'boolean' ? { exact: value.exact } : {}),
  }
}
