// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReStale } from './useReStale.js'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'
import { MockEventSource } from '@/test-fixtures/event-source.js'
import type { AdaptedInvalidateCallback } from '@/client/core/client-contracts.js'
import { makeAdaptedCallback } from '@/client/core/client-contracts.js'
import type { SignalTarget } from '@/types/protocol.js'

/**
 * Test helper: cast a plain function to a branded AdaptedInvalidateCallback so
 * unit tests can pass bare vi.fn() mocks without involving real adapters.
 */
function asAdapter<T extends SignalTarget>(fn: (...args: any[]) => any): AdaptedInvalidateCallback<T> {
  return fn as unknown as AdaptedInvalidateCallback<T>
}

describe('useReStale', () => {
  let originalEventSource: typeof globalThis.EventSource

  beforeEach(() => {
    originalEventSource = globalThis.EventSource
    MockEventSource.clear()
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
  })

  afterEach(() => {
    globalThis.EventSource = originalEventSource
    vi.restoreAllMocks()
  })

  it('opens connection on mount and closes on unmount', () => {
    const spy = vi.spyOn(SSEInvalidatorClient.prototype, 'closeWithUnmount')
    const onInvalidate = asAdapter<'swr'>(vi.fn())
    const { unmount } = renderHook(() =>
      useReStale('/sse', { onInvalidate })
    )

    expect(MockEventSource.instances).toHaveLength(1)
    const instance = MockEventSource.instances[0]
    act(() => {
      instance.emitOpen()
    })

    unmount()
    expect(instance.readyState).toBe(MockEventSource.CLOSED)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not open connection when disabled is true', () => {
    const onInvalidate = asAdapter<'swr'>(vi.fn())
    renderHook(() =>
      useReStale('/sse', { disabled: true, onInvalidate })
    )

    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('forwards invalidate events to the latest onInvalidate callback', () => {
    const callbackRef = asAdapter<'tanstack-query'>(vi.fn())
    const { rerender } = renderHook(
      ({ cb }) => useReStale('/sse', { onInvalidate: cb }),
      { initialProps: { cb: callbackRef } }
    )

    const nextCallback = asAdapter<'tanstack-query'>(vi.fn())
    rerender({ cb: nextCallback })

    const instance = MockEventSource.instances[0]
    act(() => {
      instance.emitOpen()
      instance.emitCustomEvent('invalidate', JSON.stringify({ key: ['items'] }))
    })

    expect(callbackRef).not.toHaveBeenCalled()
    expect(nextCallback).toHaveBeenCalledWith({ key: ['items'] })
  })

  it('exposes reconnect and close handlers', () => {
    const onInvalidate = asAdapter<'swr'>(vi.fn())
    const { result } = renderHook(() =>
      useReStale('/sse', { onInvalidate })
    )

    expect(result.current.connectionId).toBeDefined()
    expect(result.current.connection.status).toBe('connecting')

    const instance = MockEventSource.instances[0]
    act(() => {
      instance.emitOpen()
    })
    expect(result.current.connection.status).toBe('open')

    act(() => {
      result.current.close()
    })

    expect(result.current.connection).toEqual({ status: 'closed', reason: 'manual' })
  })

  // --- T-01: explicit target forwarded to EventSource URL ---

  it('appends __restale_target__ to EventSource URL when target is explicitly set', () => {
    const onInvalidate = asAdapter<'swr'>(vi.fn())
    renderHook(() =>
      useReStale('/sse', { onInvalidate, target: 'swr' })
    )

    expect(MockEventSource.instances).toHaveLength(1)
    const url = MockEventSource.instances[0]?.url ?? ''
    expect(url).toContain('__restale_target__=swr')
  })

  // --- T-02: brand auto-infer — adapter brand drives __restale_target__ without explicit target ---

  it('auto-infers __restale_target__ from the adapter brand when target is not explicitly set', () => {
    // Use makeAdaptedCallback to create a properly-branded callback (mirrors what
    // useSwrAdapter / useTanstackQueryAdapter do at runtime).
    const brandedSwr = makeAdaptedCallback('swr', vi.fn())
    renderHook(() =>
      useReStale('/sse', { onInvalidate: brandedSwr })
    )

    expect(MockEventSource.instances).toHaveLength(1)
    const url = MockEventSource.instances[0]?.url ?? ''
    // Brand 'swr' must be read from onInvalidate.__restaleTarget and appended to URL
    expect(url).toContain('__restale_target__=swr')
  })

  it('explicit target overrides the adapter brand', () => {
    // Brand says 'swr' but caller explicitly passes 'tanstack-query' — explicit wins
    const brandedSwr = makeAdaptedCallback('swr', vi.fn())
    renderHook(() =>
      useReStale('/sse', { onInvalidate: brandedSwr as any, target: 'tanstack-query' as any })
    )

    const url = MockEventSource.instances[0]?.url ?? ''
    expect(url).toContain('__restale_target__=tanstack-query')
    expect(url).not.toContain('__restale_target__=swr')
  })
})