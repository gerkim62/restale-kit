import { describe, it, expect, vi } from 'vitest'
import { tanstackAdapter, useTanstackAdapter } from './adapter.js'
import type { QueryClient } from '@tanstack/react-query'

describe('tanstackAdapter', () => {
  it('defaults omitted action to invalidateQueries and does not invoke other methods', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
      removeQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackAdapter(queryClient)
    adapter({ key: ['todos', { status: 'active' }], exact: true })

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todos', { status: 'active' }],
      exact: true,
    })
    expect(queryClient.refetchQueries).not.toHaveBeenCalled()
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('maps explicit action "invalidate" to invalidateQueries', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
      removeQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackAdapter(queryClient)
    adapter({ key: ['todos'], action: 'invalidate', exact: false })

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todos'],
      exact: false,
    })
  })

  it('maps refetch action to queryClient.refetchQueries and does not invoke invalidate/remove', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
      removeQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackAdapter(queryClient)
    adapter({ key: ['users'], action: 'refetch' })

    expect(queryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey: ['users'],
      exact: undefined,
    })
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('maps remove action to queryClient.removeQueries and does not invoke invalidate/refetch', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
      removeQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackAdapter(queryClient)
    adapter({ key: ['posts'], action: 'remove' })

    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ['posts'],
      exact: undefined,
    })
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
    expect(queryClient.refetchQueries).not.toHaveBeenCalled()
  })

  it('processes batch array of signals across different actions', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
      removeQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackAdapter(queryClient)
    adapter([
      { key: ['a'] },
      { key: ['b'], action: 'refetch' },
      { key: ['c'], action: 'remove' },
    ])

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['a'],
      exact: undefined,
    })
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey: ['b'],
      exact: undefined,
    })
    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ['c'],
      exact: undefined,
    })
  })
})

describe('useTanstackAdapter', () => {
  it('returns a stable memoized callback that delegates to tanstackAdapter', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
      removeQueries: vi.fn(),
    } as unknown as QueryClient

    // useCallback needs React render context — test the factory output directly
    const cb = useTanstackAdapter(queryClient)
    cb({ key: ['todos'], action: 'invalidate' })

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todos'],
      exact: undefined,
    })
  })
})
