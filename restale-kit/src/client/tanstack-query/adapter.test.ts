// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { tanstackQueryAdapter, useTanstackQueryAdapter } from './adapter.js'
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

  it('supports legacy/generic signals with key property', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackQueryAdapter(queryClient)
    adapter({ key: ['legacy'] })

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['legacy'],
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
})


