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
})

describe('RestaleProviderProps type contracts', () => {
  it('accepts generic base context', () => {
    type Base = { userId: string; tenantId: number }
    type Props = RestaleProviderProps<Base>

    expectTypeOf<Props['initialClientContext']>().toEqualTypeOf<Base | undefined>()
  })
})
