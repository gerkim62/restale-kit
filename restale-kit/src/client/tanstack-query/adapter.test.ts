// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { tanstackQueryAdapter, useTanstackQueryAdapter, type QueryClientLike } from './adapter.js'
import type { QueryClient } from '@tanstack/react-query'
import type { TanStackQuerySignal } from '@/types/protocol.js'

describe('tanstackQueryAdapter', () => {
  it('defaults omitted action to invalidateQueries', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
      removeQueries: vi.fn(),
      resetQueries: vi.fn(),
      cancelQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackQueryAdapter(queryClient)
    const signal: TanStackQuerySignal = {
      target: 'tanstack-query',
      queryKey: ['todos', { status: 'active' }],
      exact: true,
    }
    adapter(signal)

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todos', { status: 'active' }],
      exact: true,
    })
    expect(queryClient.refetchQueries).not.toHaveBeenCalled()
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('maps stale: true to refetchType none for invalidate', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackQueryAdapter(queryClient)
    const signal: TanStackQuerySignal = {
      target: 'tanstack-query',
      queryKey: ['todos'],
      stale: true,
    }
    adapter(signal)

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todos'],
      refetchType: 'none',
    })
  })

  it('maps reset and cancel actions', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      resetQueries: vi.fn(),
      cancelQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackQueryAdapter(queryClient)
    adapter([
      { target: 'tanstack-query', queryKey: ['reset-key'], action: 'reset', type: 'active' },
      { target: 'tanstack-query', queryKey: ['cancel-key'], action: 'cancel' },
    ])

    expect(queryClient.resetQueries).toHaveBeenCalledWith({
      queryKey: ['reset-key'],
      type: 'active',
    })
    expect(queryClient.cancelQueries).toHaveBeenCalledWith({
      queryKey: ['cancel-key'],
    })
  })

  it('maps refetch action to queryClient.refetchQueries', () => {
    const queryClient = {
      refetchQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackQueryAdapter(queryClient)
    adapter({ target: 'tanstack-query', queryKey: ['users'], action: 'refetch' })

    expect(queryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey: ['users'],
    })
  })

  it('maps remove action to queryClient.removeQueries', () => {
    const queryClient = {
      removeQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackQueryAdapter(queryClient)
    adapter({ target: 'tanstack-query', queryKey: ['posts'], action: 'remove' })

    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ['posts'],
    })
  })

  it('ignores signals targeting other frameworks', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      removeQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackQueryAdapter(queryClient)
    adapter({ target: 'swr', key: ['todos'] } as any)
    adapter({ target: 'rtk-query', tags: ['todos'] } as any)

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('ignores signals missing queryKey property', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackQueryAdapter(queryClient)
    adapter({ key: ['legacy'] } as any)

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
  })

  it('exposes __restaleTarget brand set to "tanstack-query"', () => {
    const queryClient = {} as unknown as QueryClient
    const adapter = tanstackQueryAdapter(queryClient)
    expect((adapter as any).__restaleTarget).toBe('tanstack-query')
  })

  it('writes optimisticData into the cache and revalidates by default', () => {
    const cache = new Map<string, unknown>()
    const invalidations: unknown[] = []
    const queryClient: QueryClientLike = {
      setQueryData(queryKey, data) {
        cache.set(JSON.stringify(queryKey), data)
      },
      invalidateQueries(filters) {
        invalidations.push(filters)
        return Promise.resolve()
      },
      removeQueries: () => {},
      resetQueries: () => Promise.resolve(),
      cancelQueries: () => Promise.resolve(),
      refetchQueries: () => Promise.resolve(),
    }

    tanstackQueryAdapter(queryClient)({
      target: 'tanstack-query',
      queryKey: ['todos'],
      exact: true,
      optimisticData: { id: 1, done: true },
    })

    expect(cache.get(JSON.stringify(['todos']))).toEqual({ id: 1, done: true })
    expect(invalidations).toEqual([{ queryKey: ['todos'], exact: true }])
  })

  it('writes optimisticData without revalidation when configured as trusted', () => {
    const cache = new Map<string, unknown>()
    const invalidations: unknown[] = []
    const queryClient: QueryClientLike = {
      setQueryData(queryKey, data) {
        cache.set(JSON.stringify(queryKey), data)
      },
      invalidateQueries(filters) {
        invalidations.push(filters)
        return Promise.resolve()
      },
      removeQueries: () => {},
      resetQueries: () => Promise.resolve(),
      cancelQueries: () => Promise.resolve(),
      refetchQueries: () => Promise.resolve(),
    }

    tanstackQueryAdapter(queryClient, { revalidateOptimisticData: false })({
      target: 'tanstack-query',
      queryKey: ['todos'],
      optimisticData: { id: 2 },
    })

    expect(cache.get(JSON.stringify(['todos']))).toEqual({ id: 2 })
    expect(invalidations).toEqual([])
  })

  it('uses setQueriesData with full query filters scope when available on QueryClient', () => {
    const setQueriesData = vi.fn()
    const invalidateQueries = vi.fn().mockResolvedValue(undefined)
    const queryClient: QueryClientLike = {
      setQueryData: vi.fn(),
      setQueriesData,
      invalidateQueries,
      removeQueries: () => {},
      resetQueries: () => Promise.resolve(),
      cancelQueries: () => Promise.resolve(),
      refetchQueries: () => Promise.resolve(),
    }

    tanstackQueryAdapter(queryClient)({
      target: 'tanstack-query',
      queryKey: ['todos'],
      exact: false,
      type: 'active',
      optimisticData: { id: 3 },
    })

    expect(setQueriesData).toHaveBeenCalledWith(
      { queryKey: ['todos'], exact: false, type: 'active' },
      { id: 3 }
    )
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todos'],
      exact: false,
      type: 'active',
    })
  })
})

describe('useTanstackQueryAdapter', () => {
  it('returns a stable memoized callback that delegates to tanstackQueryAdapter', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient

    const { result, rerender } = renderHook(
      ({ client }) => useTanstackQueryAdapter(client),
      { initialProps: { client: queryClient } }
    )

    const cb1 = result.current
    cb1({ target: 'tanstack-query', queryKey: ['todos'], action: 'invalidate' })

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todos'],
    })

    rerender({ client: queryClient })
    const cb2 = result.current
    expect(cb1).toBe(cb2)
  })

  it('maintains a stable callback reference across rerenders with updated options and respects new option values', () => {
    const setQueryData = vi.fn()
    const invalidateQueries = vi.fn()
    const queryClient = {
      setQueryData,
      invalidateQueries,
      removeQueries: vi.fn(),
      resetQueries: vi.fn(),
      cancelQueries: vi.fn(),
      refetchQueries: vi.fn(),
    } as unknown as QueryClient

    const options1 = { revalidateOptimisticData: true }
    const options2 = { revalidateOptimisticData: false }

    const { result, rerender } = renderHook(
      ({ opts }) => useTanstackQueryAdapter(queryClient, opts),
      { initialProps: { opts: options1 } }
    )

    const cb1 = result.current

    // Rerender with new options object
    rerender({ opts: options2 })
    expect(result.current).toBe(cb1)

    // Invoke callback and verify options2 is respected (revalidateOptimisticData: false -> no invalidateQueries call)
    cb1({
      target: 'tanstack-query',
      queryKey: ['todos'],
      optimisticData: { id: 1 },
    })

    expect(setQueryData).toHaveBeenCalledWith(['todos'], { id: 1 })
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('exposes __restaleTarget brand set to "tanstack-query"', () => {
    const queryClient = {} as unknown as QueryClient
    const { result } = renderHook(() => useTanstackQueryAdapter(queryClient))
    expect((result.current as any).__restaleTarget).toBe('tanstack-query')
  })
})

