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
      expectTypeOf(event.detail).toEqualTypeOf<ConnectionStatus>()
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
    expectTypeOf(cb).toExtend<AdaptedInvalidateCallback<'swr', SWRSignal>>()
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

describe('SSEInvalidatorClient typed event listeners', () => {
  test('invalidate event detail is TSignal | TSignal[]', () => {
    const client = new SSEInvalidatorClient<SWRSignal>('https://example.com/sse', {
      target: 'swr',
    })

    client.addEventListener('invalidate', (event) => {
      expectTypeOf(event.detail).toEqualTypeOf<SWRSignal | SWRSignal[]>()
    })
  })

  test('revoke event detail carries RevokeEventDetail', () => {
    const client = new SSEInvalidatorClient('https://example.com/sse')

    client.addEventListener('revoke', (event) => {
      // Verify the detail type matches the RevokeEventDetail union
      expectTypeOf(event.detail).toMatchTypeOf<{ reason?: string }>()
    })
  })

  test('renew event detail is RenewEventDetail', () => {
    const client = new SSEInvalidatorClient('https://example.com/sse')

    client.addEventListener('renew', (event) => {
      expectTypeOf(event.detail.reason).toEqualTypeOf<'deadline'>()
      expectTypeOf(event.detail.maxAttempts).toEqualTypeOf<number>()
      expectTypeOf(event.detail.retryDelayMs).toEqualTypeOf<number>()
    })
  })

  test('rejected event detail is RejectedConnectionResponse', () => {
    const client = new SSEInvalidatorClient('https://example.com/sse')

    client.addEventListener('rejected', (event) => {
      expectTypeOf(event.detail.status).toEqualTypeOf<number>()
      expectTypeOf(event.detail.headers).toEqualTypeOf<Readonly<Record<string, readonly string[]>>>()
    })
  })

  test('error event detail is Event', () => {
    const client = new SSEInvalidatorClient('https://example.com/sse')

    client.addEventListener('error', (event) => {
      expectTypeOf(event.detail).toEqualTypeOf<Event>()
    })
  })
})

describe('SSEInvalidatorClient additional properties', () => {
  test('connectionId is string', () => {
    const client = new SSEInvalidatorClient('https://example.com/sse')
    expectTypeOf(client.connectionId).toEqualTypeOf<string>()
  })

  test('endpointUrl is string', () => {
    const client = new SSEInvalidatorClient('https://example.com/sse')
    expectTypeOf(client.endpointUrl).toEqualTypeOf<string>()
  })

  test('lastEventId is string | null', () => {
    const client = new SSEInvalidatorClient('https://example.com/sse')
    expectTypeOf(client.lastEventId).toEqualTypeOf<string | null>()
  })

  test('closeWithUnmount returns void', () => {
    const client = new SSEInvalidatorClient('https://example.com/sse')
    expectTypeOf(client.closeWithUnmount()).toEqualTypeOf<void>()
  })
})

describe('ClientOptions callback and hook types', () => {
  test('callback option accepts AdaptedInvalidateCallback', () => {
    const cb = makeAdaptedCallback('swr', (_signal: SWRSignal) => {})

    new SSEInvalidatorClient<SWRSignal>('https://example.com/sse', {
      target: 'swr',
      callback: cb,
    })
  })

  test('onConnect and onDisconnect accept Event handlers', () => {
    new SSEInvalidatorClient('https://example.com/sse', {
      onConnect: (event) => {
        expectTypeOf(event).toEqualTypeOf<Event>()
      },
      onDisconnect: (event) => {
        expectTypeOf(event).toEqualTypeOf<Event>()
      },
    })
  })

  test('onError accepts unknown error handler', () => {
    new SSEInvalidatorClient('https://example.com/sse', {
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<unknown>()
      },
    })
  })
})
