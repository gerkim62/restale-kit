import { describe, test, expectTypeOf } from 'vitest'
import { SSEChannelGroup } from './channel-group.js'
import type { TanStackQuerySignal } from '../../types/protocol.js'

describe('SSEChannelGroup targeted contextual broadcast type safety', () => {
  interface UserMeta {
    userId: string
    role: 'admin' | 'user'
  }

  interface ProductContext {
    page: number
    sort: 'price' | 'rating'
  }

  test('typechecks where and signal parameters with explicit meta and clientContext types', () => {
    const group = new SSEChannelGroup<
      TanStackQuerySignal,
      UserMeta,
      'tanstack-query',
      ProductContext
    >({
      target: 'tanstack-query',
    })

    void group.broadcast({
      where: (meta, context) => {
        expectTypeOf(meta).toEqualTypeOf<UserMeta | undefined>()
        expectTypeOf(context).toEqualTypeOf<ProductContext | undefined>()
        return meta?.role === 'admin' && context?.page === 1
      },
      signal: async (meta, context) => {
        expectTypeOf(meta).toEqualTypeOf<UserMeta | undefined>()
        expectTypeOf(context).toEqualTypeOf<ProductContext | undefined>()
        return {
          queryKey: ['products'],
          optimisticData: [{ id: 1 }],
        }
      },
    })
  })

  test('rejects invalid return types and mismatched signals via compile-time errors', () => {
    const group = new SSEChannelGroup<
      TanStackQuerySignal,
      UserMeta,
      'tanstack-query',
      ProductContext
    >({
      target: 'tanstack-query',
    })

    void group.broadcast({
      // @ts-expect-error where must return boolean, not string
      where: (meta, context) => {
        return 'not-a-boolean'
      },
      signal: async () => {
        return { queryKey: ['products'] }
      },
    })

    void group.broadcast({
      where: () => true,
      // @ts-expect-error signal cannot return SWR signal shape (key) when group target is tanstack-query
      signal: async () => {
        return { key: ['products'] }
      },
    })

    void group.broadcast({
      where: (meta, context) => {
        // @ts-expect-error nonExistentField does not exist on ProductContext
        return context?.nonExistentField === true
      },
      signal: async () => {
        return { queryKey: ['products'] }
      },
    })
  })
})
