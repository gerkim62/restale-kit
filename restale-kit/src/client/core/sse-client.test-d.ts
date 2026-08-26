import { expectTypeOf, test } from 'vitest'
import { SSEClient } from '@/client/core/index'
import type { ClientOptions, ConnectionStatus } from '@/client/core/index'

test('SSEClient constructor and instance type contracts', () => {
  const options: ClientOptions = {
    autoReconnect: true,
    reconnect: {
      baseDelayMs: 500,
      maxDelayMs: 10_000,
      maxRetries: 5,
      jitter: true,
      retryAfter: 'respect',
      nonRetryableStatuses: [400, 401, 403, 404],
    },
    withCredentials: true,
  }

  const client = new SSEClient('/sse', options)

  expectTypeOf(client.connectionId).toEqualTypeOf<string | undefined>()
  expectTypeOf(client.status).toEqualTypeOf<ConnectionStatus>()
  expectTypeOf(client.endpointUrl).toEqualTypeOf<string>()
  expectTypeOf(client.attempt).toEqualTypeOf<number>()
  expectTypeOf(client.lastEventId).toEqualTypeOf<string | null>()
  expectTypeOf(client.connect()).toEqualTypeOf<Promise<void>>()
  expectTypeOf(client.close).returns.toEqualTypeOf<void>()

  // Event listener types
  client.addEventListener('invalidate', (e) => {
    expectTypeOf(e.type).toEqualTypeOf<string>()
  })
  client.addEventListener('revoke', (e) => {
    expectTypeOf(e.type).toEqualTypeOf<string>()
  })
  client.addEventListener('renew', (e) => {
    expectTypeOf(e.type).toEqualTypeOf<string>()
  })
  client.addEventListener('statuschange', (e) => {
    expectTypeOf(e.type).toEqualTypeOf<string>()
  })
})
