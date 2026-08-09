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
    expectTypeOf<TanStackQuerySignal['target']>().toEqualTypeOf<'tanstack-query' | undefined>()
    expectTypeOf<SWRSignal['target']>().toEqualTypeOf<'swr' | undefined>()
    expectTypeOf<RTKQuerySignal['target']>().toEqualTypeOf<'rtk-query' | undefined>()
    expectTypeOf<GenericInvalidateSignal['target']>().toEqualTypeOf<'generic' | undefined>()
  })

  test('signal actions are exact string literal unions', () => {
    expectTypeOf<TanStackQueryAction>().toEqualTypeOf<'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel'>()
    expectTypeOf<SWRAction>().toEqualTypeOf<'mutate'|'purge' | 'remove' | 'revalidate' >()
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
    expectTypeOf(ttlOpt).toExtend<LifetimeOptions>()
    expectTypeOf(deadlineOpt).toExtend<LifetimeOptions>()
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
      requested: 'rtk',
      supported: ['swr'],
    }
    expectTypeOf(deadlineRevoke.reason).toExtend<string | undefined>()
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

describe('Signal payload strict narrowing', () => {
  test('rejects invalid action string on SWRSignal', () => {
    // @ts-expect-error 'unknown-action' is not a valid SWRAction
    const _invalidSignal: SWRSignal = { target: 'swr', key: 'users', action: 'unknown-action' }
  })

  test('rejects invalid action string on TanStackQuerySignal', () => {
    // @ts-expect-error 'purge' is not a valid TanStackQueryAction
    const _invalidSignal: TanStackQuerySignal = { target: 'tanstack-query', queryKey: ['users'], action: 'purge' }
  })

  test('rejects non-JSONValue in TanStackQuerySignal queryKey', () => {
    // @ts-expect-error functions are not valid JSONValue elements in queryKey
    const _invalidKeySignal: TanStackQuerySignal = { target: 'tanstack-query', queryKey: [() => {}] }
  })
})

describe('optimistic data push signal types', () => {
  test('TanStack and generic signals accept JSON optimisticData and reject non-JSON values', () => {
    const tanstack: TanStackQuerySignal = {
      queryKey: ['todos'],
      optimisticData: { id: 1, done: true },
    }
    const generic: GenericInvalidateSignal = {
      key: ['todos'],
      optimisticData: ['updated', 1],
    }
    expectTypeOf(tanstack.optimisticData).toEqualTypeOf<JSONValue | undefined>()
    expectTypeOf(generic.optimisticData).toEqualTypeOf<JSONValue | undefined>()

    // @ts-expect-error functions do not survive a JSON round trip
    const invalidTanstack: TanStackQuerySignal = { queryKey: ['todos'], optimisticData: () => {} }
    // @ts-expect-error functions do not survive a JSON round trip
    const invalidGeneric: GenericInvalidateSignal = { key: ['todos'], optimisticData: () => {} }
  })

  test('SWR and TanStack use precisely the same optimisticData wire type', () => {
    expectTypeOf<SWRSignal['optimisticData']>().toEqualTypeOf<TanStackQuerySignal['optimisticData']>()
  })
})
