import { describe, expectTypeOf, test } from 'vitest'
import {
  isJSONValue,
  isJSONValueArray,
  matchesInvalidateSignalKey,
  SIGNAL_TARGETS,
  type JSONValue,
  type InvalidateSignal,
  type TanStackQuerySignal,
  type TanStackQueryAction,
  type SWRSignal,
  type SWRAction,
  type RTKQuerySignal,
  type GenericInvalidateSignal,
  type LifetimeOptions,
  type FrameGuardCtx,
  type BeforeFrameFn,
  type RevokeEventDetail,
  type RenewEventDetail,
} from '@/types/index.js'

describe('JSONValue type safety and guards', () => {
  test('isJSONValue narrows unknown to JSONValue', () => {
    const val: unknown = { a: 1, b: ['test'] }
    if (isJSONValue(val)) {
      expectTypeOf(val).toEqualTypeOf<JSONValue>()
    }
  })

  test('isJSONValueArray narrows unknown to JSONValue[]', () => {
    const val: unknown = ['a', 1, true]
    if (isJSONValueArray(val)) {
      expectTypeOf(val).toEqualTypeOf<JSONValue[]>()
    }
  })
})

describe('Discriminated Union signals & literal discriminants', () => {
  test('signal target discriminants are exact string literals', () => {
    expectTypeOf<TanStackQuerySignal['target']>().toEqualTypeOf<'tanstack-query'>()
    expectTypeOf<SWRSignal['target']>().toEqualTypeOf<'swr'>()
    expectTypeOf<RTKQuerySignal['target']>().toEqualTypeOf<'rtk-query'>()
    expectTypeOf<NonNullable<GenericInvalidateSignal['target']>>().toEqualTypeOf<'generic'>()
  })

  test('signal actions are exact string literal unions', () => {
    expectTypeOf<TanStackQueryAction>().toEqualTypeOf<'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel'>()
    expectTypeOf<SWRAction>().toEqualTypeOf<'revalidate' | 'purge' | 'remove'>()
  })

  test('unnarrowed signal variant property access causes compile error', () => {
    function checkUnnarrowed(signal: InvalidateSignal) {
      // @ts-expect-error queryKey does not exist on unnarrowed InvalidateSignal
      const _qk = signal.queryKey

      // @ts-expect-error tags does not exist on unnarrowed InvalidateSignal
      const _tags = signal.tags
    }
    expectTypeOf(checkUnnarrowed).toBeCallableWith({ target: 'swr', key: ['users'] })
  })

  test('narrowed signal variant gives exact type', () => {
    function checkNarrowed(signal: InvalidateSignal) {
      if (signal.target === 'tanstack-query') {
        expectTypeOf(signal).toEqualTypeOf<TanStackQuerySignal>()
        expectTypeOf(signal.queryKey).toEqualTypeOf<JSONValue[]>()
      } else if (signal.target === 'swr') {
        expectTypeOf(signal).toEqualTypeOf<SWRSignal>()
        expectTypeOf(signal.key).toEqualTypeOf<string | JSONValue[]>()
      }
    }
    expectTypeOf(checkNarrowed).toBeCallableWith({ target: 'tanstack-query', queryKey: ['users'] })
  })
})

describe('LifetimeOptions mutual exclusivity', () => {
  test('valid single option compiles', () => {
    const ttlOpt: LifetimeOptions = { ttlMs: 5000, onDeadline: 'reconnect' }
    const deadlineOpt: LifetimeOptions = { deadline: Date.now() + 5000, onDeadline: 'revoke' }
    expectTypeOf(ttlOpt).toMatchTypeOf<LifetimeOptions>()
    expectTypeOf(deadlineOpt).toMatchTypeOf<LifetimeOptions>()
  })

  test('passing both ttlMs and deadline should be a compile error', () => {
    // @ts-expect-error ttlMs and deadline are mutually exclusive
    const invalidOpt: LifetimeOptions = { ttlMs: 5000, deadline: 10000 }
  })
})

describe('FrameGuardCtx discrimination', () => {
  test('ctx.frameType narrows SignalFrameCtx vs KeepaliveFrameCtx', () => {
    const fn: BeforeFrameFn = (ctx: FrameGuardCtx) => {
      if (ctx.frameType === 'signal') {
        expectTypeOf(ctx.signal).toEqualTypeOf<InvalidateSignal | InvalidateSignal[]>()
      } else {
        expectTypeOf(ctx.frameType).toEqualTypeOf<'keepalive'>()
        expectTypeOf(ctx.signal).toEqualTypeOf<undefined>()
      }
      return { action: 'send' }
    }
    expectTypeOf(fn).toBeCallableWith({
      connectionId: 'c1',
      requestedTarget: undefined,
      isResume: false,
      frameType: 'keepalive',
      signal: undefined,
    })
  })
})

describe('RevokeEventDetail & RenewEventDetail', () => {
  test('RevokeEventDetail reason variants', () => {
    const deadlineRevoke: RevokeEventDetail = { reason: 'deadline' }
    const targetRevoke: RevokeEventDetail = {
      reason: 'unsupported-target',
      details: { requested: 'rtk', supported: ['swr'] },
    }
    expectTypeOf(deadlineRevoke.reason).toEqualTypeOf<'deadline' | 'unsupported-target' | string>()
  })

  test('RenewEventDetail required fields', () => {
    const renew: RenewEventDetail = {
      reason: 'deadline',
      maxAttempts: 3,
      retryDelayMs: 1000,
    }
    expectTypeOf(renew.reason).toEqualTypeOf<'deadline'>()
    expectTypeOf(renew.maxAttempts).toEqualTypeOf<number>()
    expectTypeOf(renew.retryDelayMs).toEqualTypeOf<number>()
  })
})
