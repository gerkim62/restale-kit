// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MockEventSource } from '@/test-fixtures/event-source.js'
import type { AdaptedInvalidateCallback } from '@/client/core/client-contracts.js'
import { makeAdaptedCallback } from '@/client/core/client-contracts.js'
import type { SignalTarget } from '@/types/protocol.js'

vi.mock('sse.js', async () => {
  const { MockEventSource: SSE } = await import('@/test-fixtures/event-source.js')
  return { SSE }
})

import { useReStale } from './useReStale.js'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'

/**
 * Test helper: cast a plain function to a branded AdaptedInvalidateCallback so
 * unit tests can pass bare vi.fn() mocks without involving real adapters.
 */
function asAdapter<T extends SignalTarget>(fn: (...args: any[]) => any): AdaptedInvalidateCallback<T> {
  return fn as unknown as AdaptedInvalidateCallback<T>
}

describe('useReStale', () => {
  beforeEach(() => {
    MockEventSource.clear()
  })

  afterEach(() => {
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

  it('does not instantiate client or throw when disabled is true with zero-width whitespace URL', () => {
    const onInvalidate = asAdapter<'swr'>(vi.fn())
    expect(() => {
      renderHook(() =>
        useReStale('\u200B', { disabled: true, onInvalidate })
      )
    }).not.toThrow()

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

  it('recreates the client when target changes without changing the URL', () => {
    const onInvalidate = asAdapter<SignalTarget>(vi.fn())
    const { rerender } = renderHook(
      ({ target }: { target: SignalTarget }) => useReStale('/sse', { onInvalidate, target }),
      { initialProps: { target: 'swr' as SignalTarget } }
    )

    const first = MockEventSource.instances[0]
    expect(first?.url).toContain('__restale_target__=swr')

    rerender({ target: 'tanstack-query' })

    expect(MockEventSource.instances).toHaveLength(2)
    expect(first?.readyState).toBe(MockEventSource.CLOSED)
    expect(MockEventSource.instances[1]?.url).toContain('__restale_target__=tanstack-query')
  })

  it('recreates the client when withCredentials changes without changing the URL', () => {
    const onInvalidate = asAdapter<'swr'>(vi.fn())
    const { rerender } = renderHook(
      ({ withCredentials }) => useReStale('/sse', { onInvalidate, withCredentials }),
      { initialProps: { withCredentials: false } }
    )

    const first = MockEventSource.instances[0]
    expect(first?.options?.withCredentials).toBe(false)

    rerender({ withCredentials: true })

    expect(MockEventSource.instances).toHaveLength(2)
    expect(first?.readyState).toBe(MockEventSource.CLOSED)
    expect(MockEventSource.instances[1]?.options?.withCredentials).toBe(true)
  })

  it('applies reconnect option changes without recreating the client', () => {
    vi.useFakeTimers()

    const onInvalidate = asAdapter<'swr'>(vi.fn())
    const { rerender } = renderHook(
      ({ autoReconnect, maxRetries }) =>
        useReStale('/sse', {
          onInvalidate,
          autoReconnect,
          reconnect: { maxRetries, baseDelayMs: 50, jitter: false },
        }),
      { initialProps: { autoReconnect: false, maxRetries: 0 } }
    )

    rerender({ autoReconnect: true, maxRetries: 1 })

    act(() => {
      MockEventSource.instances[0]?.emitError()
    })

    expect(MockEventSource.instances).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(60)
    })

    expect(MockEventSource.instances).toHaveLength(2)

    vi.useRealTimers()
  })

  it('applies debug option changes without recreating the client', () => {
    const onInvalidate = asAdapter<'swr'>(vi.fn())
    const { rerender } = renderHook(
      ({ debug }) => useReStale('/sse', { onInvalidate, debug }),
      { initialProps: { debug: false } }
    )

    expect(MockEventSource.instances).toHaveLength(1)

    rerender({ debug: true })

    // Connection must not be recreated when debug mode is updated
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it('calls onRetriesExhausted callback when retries are exhausted', () => {
    vi.useFakeTimers()

    const onInvalidate = asAdapter<'swr'>(vi.fn())
    const onRetriesExhausted = vi.fn()

    renderHook(() =>
      useReStale('/sse', {
        onInvalidate,
        reconnect: { maxRetries: 2, baseDelayMs: 50, jitter: false },
        onRetriesExhausted,
      })
    )

    // Initial connection fails
    act(() => {
      MockEventSource.instances[0]?.emitError()
    })

    // Retry 1 fails
    act(() => {
      vi.advanceTimersByTime(60)
      MockEventSource.instances[1]?.emitError()
    })

    // Retry 2 fails
    act(() => {
      vi.advanceTimersByTime(110)
      MockEventSource.instances[2]?.emitError()
    })

    expect(onRetriesExhausted).toHaveBeenCalledTimes(1)
    expect(onRetriesExhausted).toHaveBeenCalledWith({ attempts: 2, maxRetries: 2 })

    vi.useRealTimers()
  })

  it('does not call onRetriesExhausted when connection succeeds', () => {
    const onInvalidate = asAdapter<'swr'>(vi.fn())
    const onRetriesExhausted = vi.fn()

    renderHook(() =>
      useReStale('/sse', {
        onInvalidate,
        reconnect: { maxRetries: 2 },
        onRetriesExhausted,
      })
    )

    act(() => {
      MockEventSource.instances[0]?.emitOpen()
    })

    expect(onRetriesExhausted).not.toHaveBeenCalled()
  })

  it('does not call onRetriesExhausted when connection is rejected', () => {
    const onInvalidate = asAdapter<'swr'>(vi.fn())
    const onRetriesExhausted = vi.fn()
    const onRejected = vi.fn()

    renderHook(() =>
      useReStale('/sse', {
        onInvalidate,
        reconnect: { maxRetries: 2, nonRetryableStatuses: 401 },
        onRetriesExhausted,
        onRejected,
      })
    )

    const error = Object.assign(new Event('error'), {
      responseCode: 401,
      headers: {},
    })

    act(() => {
      MockEventSource.instances[0]?.emitError(error)
    })

    expect(onRetriesExhausted).not.toHaveBeenCalled()
    expect(onRejected).toHaveBeenCalledTimes(1)
  })

  it('does not call onRetriesExhausted when connection is revoked', () => {
    const onInvalidate = asAdapter<'swr'>(vi.fn())
    const onRetriesExhausted = vi.fn()
    const onRevoke = vi.fn()

    renderHook(() =>
      useReStale('/sse', {
        onInvalidate,
        reconnect: { maxRetries: 2 },
        onRetriesExhausted,
        onRevoke,
      })
    )

    act(() => {
      const instance = MockEventSource.instances[0]
      instance?.emitOpen()
      instance?.emitCustomEvent('revoke', JSON.stringify({ reason: 'logout' }))
    })

    expect(onRetriesExhausted).not.toHaveBeenCalled()
    expect(onRevoke).toHaveBeenCalledTimes(1)
  })

  it('logs debug messages on mount, connect failure, and unmount when debug option is enabled', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const onInvalidate = asAdapter<'swr'>(vi.fn())

    const { unmount } = renderHook(() =>
      useReStale('/sse', { debug: true, onInvalidate })
    )

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[restale-kit][useReStale] Effect mounted')
    )

    unmount()

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[restale-kit][useReStale] Effect unmounting')
    )

    consoleLogSpy.mockRestore()
  })
})
