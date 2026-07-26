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
