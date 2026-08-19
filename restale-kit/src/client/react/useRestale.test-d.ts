import { describe, it, expectTypeOf } from 'vitest'
import type { RestaleProviderProps } from './RestaleProvider.js'
import { useRestale } from './useRestale.js'
import type { UseRestaleResult, ConnectionSnapshot } from './useRestale.js'

describe('useRestale type inference', () => {
  it('infers Record<string, unknown> as effective context when called with no arguments', () => {
    const result = useRestale()
    expectTypeOf(result).toEqualTypeOf<UseRestaleResult<Record<string, unknown>>>()
    expectTypeOf(result.clientContext).toEqualTypeOf<Record<string, unknown>>()
    expectTypeOf(result.isConnected).toEqualTypeOf<boolean>()
    expectTypeOf(result.connection).toEqualTypeOf<ConnectionSnapshot>()
    expectTypeOf(result.connectionId).toEqualTypeOf<string>()
    expectTypeOf(result.reconnect).toEqualTypeOf<() => Promise<void>>()
    expectTypeOf(result.close).toEqualTypeOf<() => void>()
  })

  it('infers effective context when called with specific clientContext in merge mode (default)', () => {
    const result = useRestale({
      clientContext: { page: 1, search: 'test' },
    })

    expectTypeOf(result.clientContext).toEqualTypeOf<{
      page: number
      search: string
    }>()
  })

  it('infers effective context when called in replace mode', () => {
    const result = useRestale({
      clientContext: { customKey: true },
      clientContextMode: 'replace',
    })

    expectTypeOf(result.clientContext).toEqualTypeOf<{ customKey: boolean }>()
  })

  it('infers typed context when called with no arguments but explicit generic', () => {
    interface AppEffectiveContext {
      userId: string
      tenantId: string
    }
    const result = useRestale<AppEffectiveContext>()
    expectTypeOf(result).toEqualTypeOf<UseRestaleResult<AppEffectiveContext>>()
    expectTypeOf(result.clientContext).toEqualTypeOf<AppEffectiveContext>()
  })

  it('supports explicit generic override when needed', () => {
    interface AppEffectiveContext {
      userId: string
      page: number
    }

    const result = useRestale<{ page: number }, AppEffectiveContext>({
      clientContext: { page: 2 },
    })

    expectTypeOf(result.clientContext).toEqualTypeOf<AppEffectiveContext>()
  })

  it('ensures reconnect and close functions are standalone callable without this binding', () => {
    const { reconnect, close } = useRestale()
    expectTypeOf(reconnect).toEqualTypeOf<() => Promise<void>>()
    expectTypeOf(close).toEqualTypeOf<() => void>()
  })
})

describe('RestaleProviderProps type contracts', () => {
  it('accepts generic base context', () => {
    type Base = { userId: string; tenantId: number }
    type Props = RestaleProviderProps<Base>

    expectTypeOf<Props['initialClientContext']>().toEqualTypeOf<Base | undefined>()
  })

  it('accepts default untyped RestaleProviderProps', () => {
    type Props = RestaleProviderProps
    expectTypeOf<Props['initialClientContext']>().toEqualTypeOf<Record<string, unknown> | undefined>()
  })
})
