import { useCallback } from 'react'
import type { RTKQuerySignal } from '@/types/protocol.js'
import { isObject } from '@/pubsub/core/pubsub-utils.js'
import { SIGNAL_TARGETS } from '@/utils/constants.js'
import type { AdaptedInvalidateCallback } from '@/client/core/client-contracts.js'
import { makeAdaptedCallback } from '@/client/core/client-contracts.js'

export type RTKQuerySignalInput = RTKQuerySignal

export interface RTKQueryApiLike {
  util: {
    invalidateTags: (tags: RTKQuerySignal['tags']) => void
  }
}

export function rtkQueryAdapter<TSignal extends RTKQuerySignal = RTKQuerySignal>(
  api: RTKQueryApiLike
): AdaptedInvalidateCallback<'rtk-query', TSignal> {
  return makeAdaptedCallback(
    SIGNAL_TARGETS.RTK,
    (signal: TSignal | TSignal[]) => {
      const list = Array.isArray(signal) ? signal : [signal]
      for (const s of list) {
        if (!isObject(s)) continue
        const target = s.target
        if (target !== undefined && target !== SIGNAL_TARGETS.RTK) {
          continue
        }
        if ('tags' in s && Array.isArray(s.tags)) {
          api.util.invalidateTags(s.tags)
        }
      }
    }
  )
}

export function useRtkQueryAdapter<TSignal extends RTKQuerySignal = RTKQuerySignal>(
  api: RTKQueryApiLike
): AdaptedInvalidateCallback<'rtk-query', TSignal> {
  return makeAdaptedCallback(
    SIGNAL_TARGETS.RTK,
    useCallback(rtkQueryAdapter<TSignal>(api), [api])
  )
}
