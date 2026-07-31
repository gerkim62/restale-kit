import { describe, expectTypeOf, test } from 'vitest'
import { createSSEChannel } from '@/testing/index.js'
import type { SSEChannel, SSEChannelOptions } from '@/server/core/index.js'
import type {
  InvalidateSignal,
  SWRSignal,
  TanStackQuerySignal,
  RTKQuerySignal,
  GenericInvalidateSignal,
  SignalTarget,
} from '@/types/protocol.js'

describe('1.1 — SSEChannel.invalidate() generic enforcement', () => {
  test('invalidate parameter should be restricted to channel TSignal', () => {
    const channel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })

    // Valid TanStackQuerySignal compiles
    expectTypeOf(channel.invalidate).toBeCallableWith({ target: 'tanstack-query', queryKey: ['users'] })

    // @ts-expect-error SWRSignal should be rejected on TanStackQuerySignal channel
    channel.invalidate({ target: 'swr', key: ['users'] })
  })
})

describe('1.2 — Target-aware signal input (SignalInputForTarget)', () => {
  test('single-target channel signal input', () => {
    const singleChannel = createSSEChannel({ target: 'swr' })

    // Full SWRSignal compiles
    expectTypeOf(singleChannel.invalidate).toBeCallableWith({ target: 'swr', key: ['users'] })
  })

  test('multi-target channel signal input requirements', () => {
    const multiChannel = createSSEChannel({ target: ['swr', 'tanstack-query'] as const })

    // Valid multi-signal array for all declared targets should compile
    multiChannel.invalidate([
      { target: 'swr', key: ['users'] },
      { target: 'tanstack-query', queryKey: ['users'] },
    ])

    // @ts-expect-error signal without explicit target on multi-target channel should be a type error
    multiChannel.invalidate({ key: ['users'] })

    // @ts-expect-error undeclared target signal on multi-target channel should be a type error
    multiChannel.invalidate({ target: 'rtk-query', tags: ['users'] })
  })
})

describe('1.3 — Target to signal-type inference on createSSEChannel', () => {
  test('createSSEChannel target option should infer TSignal generic', () => {
    const swrChannel = createSSEChannel({ target: 'swr' })

    // Should infer SSEChannel<SWRSignal>
    expectTypeOf(swrChannel).toEqualTypeOf<SSEChannel<SWRSignal>>()

    // Explicit generic matching options.target compiles
    const explicitSwr = createSSEChannel<SWRSignal>({ target: 'swr' })
    expectTypeOf(explicitSwr).toEqualTypeOf<SSEChannel<SWRSignal>>()

    // @ts-expect-error explicit generic mismatched with options.target should be a type error
    createSSEChannel<SWRSignal>({ target: 'tanstack-query' })
  })
})

describe('1.4 — SSEChannelOptions.target optionality', () => {
  test('createSSEChannel called without target option', () => {
    // @ts-expect-error createSSEChannel requires target option
    createSSEChannel({})
  })
})

describe('SSEChannel interface surface types', () => {
  test('SSEChannel properties are strictly typed', () => {
    const channel = createSSEChannel({ target: 'swr' })
    expectTypeOf(channel.state).toEqualTypeOf<'open' | 'closed'>()
    expectTypeOf(channel.connectionId).toEqualTypeOf<string>()
    expectTypeOf(channel.stream).toEqualTypeOf<ReadableStream<Uint8Array>>()
    expectTypeOf(channel.close).toEqualTypeOf<() => void>()
    expectTypeOf(channel.disconnect).toEqualTypeOf<() => void>()
    expectTypeOf(channel.revoke).toBeCallableWith('reason string')
    expectTypeOf(channel.onClose).toBeCallableWith(() => {})
  })
})

describe('SSEChannelOptions narrowing & misuse checks', () => {
  test('invalid target string is rejected', () => {
    // @ts-expect-error target must be valid SignalTarget or array of SignalTarget
    createSSEChannel({ target: 'invalid-target-name' })
  })

  test('keepaliveIntervalMs must be number', () => {
    // @ts-expect-error keepaliveIntervalMs cannot be string
    createSSEChannel({ target: 'swr', keepaliveIntervalMs: '1000' })
  })

  test('beforeFrame requires valid FrameGuardResult', () => {
    createSSEChannel({
      target: 'swr',
      beforeFrame: (ctx) => {
        if (ctx.frameType === 'signal') {
          return { action: 'send' }
        }
        return { action: 'skip' }
      },
    })

    createSSEChannel({
      target: 'swr',
      // @ts-expect-error invalid action in return object
      beforeFrame: () => ({ action: 'invalid-action' }),
    })
  })
})

describe('SSEChannel.invalidate() return type', () => {
  test('invalidate returns a string event ID', () => {
    const channel = createSSEChannel({ target: 'swr' })
    const eventId = channel.invalidate({ target: 'swr', key: ['test'] })
    expectTypeOf(eventId).toEqualTypeOf<string>()
  })

  test('invalidate accepts optional customId parameter', () => {
    const channel = createSSEChannel({ target: 'swr' })
    expectTypeOf(channel.invalidate).toBeCallableWith(
      { target: 'swr', key: ['test'] },
      'custom-id-123'
    )
  })
})

describe('SSEChannel.target property types', () => {
  test('target is SignalTarget or readonly SignalTarget[]', () => {
    const channel = createSSEChannel({ target: 'swr' })
    expectTypeOf(channel.target).toEqualTypeOf<SignalTarget | readonly SignalTarget[]>()
  })

  test('requestedTarget is string or undefined', () => {
    const channel = createSSEChannel({ target: 'swr' })
    expectTypeOf(channel.requestedTarget).toEqualTypeOf<string | undefined>()
  })
})

describe('SSEChannel.revoke() parameter types', () => {
  test('revoke accepts optional reason string', () => {
    const channel = createSSEChannel({ target: 'swr' })
    // No args
    expectTypeOf(channel.revoke).toBeCallableWith()
    // With reason
    expectTypeOf(channel.revoke).toBeCallableWith('session-expired')
  })

  test('revoke returns void', () => {
    const channel = createSSEChannel({ target: 'swr' })
    expectTypeOf(channel.revoke()).toEqualTypeOf<void>()
  })
})

describe('SSEChannel.onClose() callback type', () => {
  test('onClose accepts a zero-arg callback returning void', () => {
    const channel = createSSEChannel({ target: 'swr' })
    expectTypeOf(channel.onClose).toBeCallableWith(() => {})
  })

  test('onClose returns void', () => {
    const channel = createSSEChannel({ target: 'swr' })
    expectTypeOf(channel.onClose(() => {})).toEqualTypeOf<void>()
  })
})
