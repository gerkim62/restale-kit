import { expectTypeOf, test } from 'vitest'
import type { EventStore, SSEChannel, SSEChannelOptions } from '@/server/core/index.js'
import { createSSEChannel } from '@/server/core/index.js'
import type { ChannelState, LifetimeOptions } from '@/types/index.js'

test('SSEChannel creation and instance type contracts', () => {
  const lifetime: LifetimeOptions = { ttlMs: 30_000, onDeadline: 'reconnect' }
  const eventStore = {} as EventStore

  const options: SSEChannelOptions = {
    connectionId: 'conn-abc-123',
    lifetime,
    eventStore,
    keepaliveIntervalMs: 15_000,
    retryIntervalMs: 3_000,
    guardKeepalive: true,
    beforeFrame: () => ({ action: 'send' }),
  }

  const channel: SSEChannel = createSSEChannel(options)

  expectTypeOf(channel.connectionId).toEqualTypeOf<string>()
  expectTypeOf(channel.state).toEqualTypeOf<ChannelState>()
  expectTypeOf(channel.stream).toEqualTypeOf<ReadableStream<Uint8Array>>()

  // invalidate accepts Signal or Signal[] and optional customId, returns string id
  expectTypeOf(channel.invalidate({ key: ['items'] })).toEqualTypeOf<string>()
  expectTypeOf(channel.invalidate([{ key: ['items'] }, { key: ['users'] }], 'evt-1')).toEqualTypeOf<string>()

  // revoke accepts optional reason string
  expectTypeOf(channel.revoke).parameter(0).toEqualTypeOf<string | undefined>()

  // disconnect and close return void
  expectTypeOf(channel.disconnect).returns.toEqualTypeOf<void>()
  expectTypeOf(channel.close).returns.toEqualTypeOf<void>()

  // onClose takes a callback and returns void
  expectTypeOf(channel.onClose).returns.toEqualTypeOf<void>()
})
