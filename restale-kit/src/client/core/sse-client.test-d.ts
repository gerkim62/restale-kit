import { describe, expectTypeOf, test } from 'vitest'
import {
  SSEInvalidatorClient,
  makeAdaptedCallback,
  type ConnectionStatus,
  type ClientOptions,
  type AdaptedInvalidateCallback,
} from '@/client/core/index.js'
import type { SWRSignal, TanStackQuerySignal } from '@/types/index.js'

describe('SSEInvalidatorClient type safety', () => {
  test('client instance properties and event handlers', () => {
    const client = new SSEInvalidatorClient('https://example.com/sse', {
      target: 'swr',
      withCredentials: true,
    })

    expectTypeOf(client.status).toEqualTypeOf<ConnectionStatus>()
    expectTypeOf(client.connect).toEqualTypeOf<() => Promise<void>>()
    expectTypeOf(client.close).toEqualTypeOf<() => void>()

    client.addEventListener('statuschange', (event) => {
      const customEv = event as CustomEvent<ConnectionStatus>
      expectTypeOf(customEv.detail).toEqualTypeOf<ConnectionStatus>()
    })
  })
})

describe('ConnectionStatus discriminated union narrowing', () => {
  test('ConnectionStatus properties are safely narrowed in function parameter', () => {
    function processStatus(status: ConnectionStatus) {
      if (status.status === 'closed') {
        expectTypeOf(status.reason).toEqualTypeOf<'manual' | 'unmount' | 'revoked' | 'rejected'>()
        if (status.reason === 'rejected') {
          expectTypeOf(status.response.status).toEqualTypeOf<number>()
        }
      } else if (status.status === 'open') {
        // @ts-expect-error response does not exist on status: 'open'
        const _res = status.response
      }
    }

    expectTypeOf(processStatus).toBeCallableWith({ status: 'open' })
  })
})

describe('AdaptedInvalidateCallback branding', () => {
  test('makeAdaptedCallback brands callback with __restaleTarget', () => {
    const cb = makeAdaptedCallback('swr', (_signal: SWRSignal | SWRSignal[]) => {})

    expectTypeOf(cb.__restaleTarget).toEqualTypeOf<'swr'>()
    expectTypeOf(cb).toMatchTypeOf<AdaptedInvalidateCallback<'swr', SWRSignal>>()
  })

  test('unbranded function lacks __restaleTarget brand property', () => {
    const plainFn = (_signal: SWRSignal | SWRSignal[]) => {}

    // @ts-expect-error plain function does not have __restaleTarget brand
    const _target = plainFn.__restaleTarget
  })
})

describe('ClientOptions misuse prevention', () => {
  test('rejects invalid target in options', () => {
    new SSEInvalidatorClient('https://example.com/sse', {
      // @ts-expect-error target must be a valid SignalTarget
      target: 'unsupported-client-target',
    })
  })

  test('nonRetryableStatuses rejects invalid status formats', () => {
    new SSEInvalidatorClient('https://example.com/sse', {
      reconnect: {
        // @ts-expect-error '6xx' is not a valid HttpStatusMatcher pattern
        nonRetryableStatuses: ['6xx'],
      },
    })
  })
})

