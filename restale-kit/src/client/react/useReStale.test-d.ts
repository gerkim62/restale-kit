import { describe, expectTypeOf, test } from 'vitest'
import { useReStale, type UseReStaleOptions, type UseReStaleResult } from '@/client/react/index.js'
import { makeAdaptedCallback } from '@/client/core/index.js'
import type { SWRSignal, TanStackQuerySignal } from '@/types/index.js'

describe('useReStale target inference and override checking', () => {
  test('infers TTarget from branded onInvalidate callback', () => {
    const swrCallback = makeAdaptedCallback('swr', (_s: SWRSignal | SWRSignal[]) => {})

    // Inferred call with no explicit type argument
    const res = useReStale('/api/sse', { onInvalidate: swrCallback })
    expectTypeOf(res).toEqualTypeOf<UseReStaleResult>()
  })

  test('matching explicit target prop compiles', () => {
    const swrCallback = makeAdaptedCallback('swr', (_s: SWRSignal | SWRSignal[]) => {})

    useReStale('/api/sse', { onInvalidate: swrCallback, target: 'swr' })
  })

  test('mismatched explicit target prop should be a compile error', () => {
    const swrCallback = makeAdaptedCallback('swr', (_s: SWRSignal | SWRSignal[]) => {})

    // @ts-expect-error target 'tanstack-query' does not match swrCallback brand 'swr'
    useReStale('/api/sse', { onInvalidate: swrCallback, target: 'tanstack-query' })
  })
})

describe('useReStale required vs optional options', () => {
  test('url and onInvalidate are required', () => {
    const swrCallback = makeAdaptedCallback('swr', (_s: SWRSignal | SWRSignal[]) => {})

    // @ts-expect-error missing onInvalidate option
    useReStale('/api/sse', {})

    // @ts-expect-error missing url argument
    useReStale({ onInvalidate: swrCallback })
  })
})

describe('restale-kit/react re-exports', () => {
  test('exports contract and lifecycle types', () => {
    type ReactExports = typeof import('@/client/react/index.js')
    expectTypeOf<ReactExports['useReStale']>().toBeFunction()

    type ReactTypes = {
      ConnectionStatus: import('@/client/react/index.js').ConnectionStatus
      RevokeEventDetail: import('@/client/react/index.js').RevokeEventDetail
      RenewEventDetail: import('@/client/react/index.js').RenewEventDetail
      RejectedConnectionResponse: import('@/client/react/index.js').RejectedConnectionResponse
      AdaptedInvalidateCallback: import('@/client/react/index.js').AdaptedInvalidateCallback
    }

    expectTypeOf<ReactTypes['ConnectionStatus']>().toBeObject()
    expectTypeOf<ReactTypes['RevokeEventDetail']>().toBeObject()
    expectTypeOf<ReactTypes['RenewEventDetail']>().toBeObject()
    expectTypeOf<ReactTypes['RejectedConnectionResponse']>().toBeObject()
  })
})
