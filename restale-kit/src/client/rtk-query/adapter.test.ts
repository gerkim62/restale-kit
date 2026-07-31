// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { rtkQueryAdapter, useRtkQueryAdapter, type RTKQueryApiLike } from './adapter.js'

describe('rtkQueryAdapter', () => {
  it('calls invalidateTags with single signal tag array', () => {
    const invalidateTags = vi.fn()
    const api: RTKQueryApiLike = { util: { invalidateTags } }
    const adapter = rtkQueryAdapter(api)

    adapter({ target: 'rtk-query', tags: ['Posts', 'Users'] })

    expect(invalidateTags).toHaveBeenCalledTimes(1)
    expect(invalidateTags).toHaveBeenCalledWith(['Posts', 'Users'])
  })

  it('calls invalidateTags for each signal in a batch array', () => {
    const invalidateTags = vi.fn()
    const api: RTKQueryApiLike = { util: { invalidateTags } }
    const adapter = rtkQueryAdapter(api)

    adapter([
      { target: 'rtk-query', tags: ['Posts'] },
      { target: 'rtk-query', tags: ['Users'] },
    ])

    expect(invalidateTags).toHaveBeenCalledTimes(2)
    expect(invalidateTags).toHaveBeenNthCalledWith(1, ['Posts'])
    expect(invalidateTags).toHaveBeenNthCalledWith(2, ['Users'])
  })

  it('handles signals with omitted target', () => {
    const invalidateTags = vi.fn()
    const api: RTKQueryApiLike = { util: { invalidateTags } }
    const adapter = rtkQueryAdapter(api)

    adapter({ target: 'rtk-query', tags: ['Comments'] })

    expect(invalidateTags).toHaveBeenCalledTimes(1)
    expect(invalidateTags).toHaveBeenNthCalledWith(1, ['Comments'])
  })

  it('ignores signals targeting generic or other frameworks', () => {
    const invalidateTags = vi.fn()
    const api: RTKQueryApiLike = { util: { invalidateTags } }
    const adapter = rtkQueryAdapter(api)

    adapter({ target: 'generic', key: ['posts'] } as any)
    adapter({ target: 'swr', key: '/api/user' } as any)
    adapter({ target: 'tanstack-query', queryKey: ['todos'] } as any)

    expect(invalidateTags).not.toHaveBeenCalled()
  })

  it('safely ignores invalid signal shapes', () => {
    const invalidateTags = vi.fn()
    const api: RTKQueryApiLike = { util: { invalidateTags } }
    const adapter = rtkQueryAdapter(api)

    adapter(null as any)
    adapter(123 as any)
    adapter({ target: 'rtk-query' } as any) // missing tags
    adapter({ target: 'rtk-query', tags: 'not-an-array' } as any)

    expect(invalidateTags).not.toHaveBeenCalled()
  })

  it('attaches target and __restaleTarget metadata to callback', () => {
    const api: RTKQueryApiLike = { util: { invalidateTags: vi.fn() } }
    const adapter = rtkQueryAdapter(api)

    expect(adapter.target).toBe('rtk-query')
    expect(adapter.__restaleTarget).toBe('rtk-query')
  })
})

describe('useRtkQueryAdapter', () => {
  it('returns memoized callback and delegates calls to invalidateTags', () => {
    const invalidateTags1 = vi.fn()
    const invalidateTags2 = vi.fn()
    const api1: RTKQueryApiLike = { util: { invalidateTags: invalidateTags1 } }
    const api2: RTKQueryApiLike = { util: { invalidateTags: invalidateTags2 } }

    const { result, rerender } = renderHook(
      ({ api }) => useRtkQueryAdapter(api),
      { initialProps: { api: api1 } }
    )

    const cb1 = result.current
    cb1({ target: 'rtk-query', tags: ['Posts'] })
    expect(invalidateTags1).toHaveBeenCalledWith(['Posts'])

    // Rerender with same reference maintains callback reference
    rerender({ api: api1 })
    expect(result.current).toBe(cb1)

    // Rerender with new api reference updates callback reference
    rerender({ api: api2 })
    expect(result.current).not.toBe(cb1)

    result.current({ target: 'rtk-query', tags: ['Users'] })
    expect(invalidateTags2).toHaveBeenCalledWith(['Users'])
  })
})
