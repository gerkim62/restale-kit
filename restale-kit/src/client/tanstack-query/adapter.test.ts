// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { tanstackQueryAdapter, useTanstackQueryAdapter, type QueryClientLike } from './adapter.js'
import type { QueryKey } from '@tanstack/react-query'

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

})

describe('useTanstackQueryAdapter', () => {
  it('keeps its callback stable while using the latest key mapper', () => {
    const queryClient = {
      invalidateQueries: vi.fn(() => Promise.resolve()),
      setQueryData: vi.fn(),
    } as unknown as QueryClientLike
    const { result, rerender } = renderHook(
      ({ options }: { options: Parameters<typeof useTanstackQueryAdapter>[1] }) =>
        useTanstackQueryAdapter(queryClient, options),
      { initialProps: { options: {} } },
    )

    const callback = result.current
    result.current({ key: ['todos'] })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['todos'], exact: undefined })

    rerender({ options: { toQueryKey: (key: QueryKey) => ['cache', ...key] } })
    expect(result.current).toBe(callback)

    result.current({ key: ['todos'], inlineData: [{ id: 1 }] })
    expect(queryClient.setQueryData).toHaveBeenLastCalledWith(['cache', 'todos'], [{ id: 1 }])
  })
})
