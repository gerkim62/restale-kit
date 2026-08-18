import { describe, it, expect, vi } from 'vitest'
import { tanstackQueryAdapter, type QueryClientLike } from './adapter.js'

describe('tanstackQueryAdapter', () => {
  it('can trust pushed inlineData without marking it stale', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryClientLike
    const adapter = tanstackQueryAdapter(queryClient)

    adapter({ key: ['todos'], inlineData: [{ id: 1 }] })

    expect(queryClient.setQueryData).toHaveBeenCalledWith(['todos'], [{ id: 1 }])
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
  })

  it('invalidates queries with exact or prefix matching', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryClientLike
    const adapter = tanstackQueryAdapter(queryClient)

    adapter({ key: ['todos'], exact: true })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['todos'], exact: true })

    adapter({ key: ['todos', 1] })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['todos', 1], exact: undefined })
  })

  it('applies toQueryKey mapper when provided', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryClientLike
    const adapter = tanstackQueryAdapter(queryClient, {
      toQueryKey: (key) => ['prefix', ...key],
    })

    adapter({ key: ['todos'] })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['prefix', 'todos'],
      exact: undefined,
    })
  })
})
