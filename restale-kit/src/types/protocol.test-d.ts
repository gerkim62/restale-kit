import { expectTypeOf, test } from 'vitest'
import type { InlineDataSignal, LifetimeOptions, OnDeadlineAction, RevalidateSignal, Signal } from '@/types/index.js'

test('signal protocol types preserve the signal distinction', () => {
  const revalidate: RevalidateSignal = { key: ['todos'], exact: true }
  const inline: InlineDataSignal = { key: ['todos'], inlineData: { id: 1 }, markStale: false }
  const signal: Signal = Math.random() > 0.5 ? revalidate : inline

  expectTypeOf(signal).toEqualTypeOf<Signal>()

  // @ts-expect-error target routing was removed from the wire protocol
  const targetSignal: Signal = { target: 'swr', key: ['todos'] }
  // @ts-expect-error inline-data signals cannot specify exact matching
  const conflictingSignal: InlineDataSignal = { key: ['todos'], inlineData: 1, exact: true }

  void targetSignal
  void conflictingSignal
})

test('OnDeadlineAction and LifetimeOptions type contracts', () => {
  const action1: OnDeadlineAction = 'reconnect'
  const action2: OnDeadlineAction = 'revoke'
  const action3: OnDeadlineAction = { maxAttempts: 5, retryDelayMs: 2000 }

  expectTypeOf(action1).toExtend<OnDeadlineAction>()
  expectTypeOf(action2).toExtend<OnDeadlineAction>()
  expectTypeOf(action3).toExtend<OnDeadlineAction>()

  const lifetime1: LifetimeOptions = { ttlMs: 60_000, onDeadline: action1 }
  const lifetime2: LifetimeOptions = { deadline: Date.now() + 60_000, onDeadline: action3 }

  expectTypeOf(lifetime1).toExtend<LifetimeOptions>()
  expectTypeOf(lifetime2).toExtend<LifetimeOptions>()

  // @ts-expect-error invalid action string
  const invalidAction: OnDeadlineAction = 'invalid'
  // @ts-expect-error cannot specify both ttlMs and deadline
  const invalidLifetime: LifetimeOptions = { ttlMs: 1000, deadline: 2000 }

  void invalidAction
  void invalidLifetime
})
