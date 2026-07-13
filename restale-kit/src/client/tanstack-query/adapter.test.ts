import { describe, it, expect, vi } from 'vitest'
import { tanstackAdapter } from './adapter.js'
import type { QueryClient } from '@tanstack/react-query'

describe('tanstackAdapter', () => {
  it('maps default invalidate action to queryClient.invalidateQueries', () => {
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
  })

  it('maps refetch action to queryClient.refetchQueries', () => {
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
  })

  it('maps remove action to queryClient.removeQueries', () => {
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
  })

  it('processes batch array of signals', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
      removeQueries: vi.fn(),
    } as unknown as QueryClient

    const adapter = tanstackAdapter(queryClient)
    adapter([{ key: ['a'] }, { key: ['b'], action: 'remove' }])

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.removeQueries).toHaveBeenCalledTimes(1)
  })
})
