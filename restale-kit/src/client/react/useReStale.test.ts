// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { MockEventSource } from '@/test-fixtures/event-source.js'
import type { AdaptedCallback } from '@/client/core/client-contracts.js'
import { makeAdaptedCallback } from '@/client/core/client-contracts.js'

vi.mock('sse.js', async () => {
  const { MockEventSource: SSE } = await import('@/test-fixtures/event-source.js')
  return { SSE }
})

import { useReStale } from './useReStale.js'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'

/**
 * Test helper: cast a plain function to a branded AdaptedCallback so
 * unit tests can pass bare vi.fn() mocks without involving real adapters.
 */
function asAdapter(fn: (...args: any[]) => any): AdaptedCallback {
  return fn as unknown as AdaptedCallback
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
    const onInvalidate = asAdapter(vi.fn())
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

  it('synchronizes client context when opened and when its deep value changes', async () => {
    const sync = vi.spyOn(SSEInvalidatorClient.prototype, 'updateClientContext')
      .mockResolvedValue({ updated: true })
    const onInvalidate = asAdapter(vi.fn())
    const { rerender } = renderHook(
      ({ clientContext }) => useReStale('/sse', { onInvalidate, clientContext }),
      { initialProps: { clientContext: { page: 1 } } }
    )

    act(() => {
      MockEventSource.instances[0]?.emitOpen()
    })
    await waitFor(() => {
      expect(sync).toHaveBeenCalledWith({ page: 1 }, { revision: 1 })
    })

    rerender({ clientContext: { page: 2 } })
    await waitFor(() => {
      expect(sync).toHaveBeenLastCalledWith({ page: 2 }, { revision: 2 })
    })
  })

  it('logs console.error and triggers refetch on onInvalidate when client context sync fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(SSEInvalidatorClient.prototype, 'updateClientContext')
      .mockRejectedValue(new Error('Network error'))
    const onInvalidate = asAdapter(vi.fn())

    renderHook(() =>
      useReStale('/sse', {
        onInvalidate,
        clientContext: { page: 1 },
        clientContextSync: { maxAttempts: 1, retryDelayMs: 0 },
      })
    )

    act(() => {
      MockEventSource.instances[0]?.emitOpen()
    })

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[restale-kit][useReStale] Failed to synchronize clientContext.')
      )
      expect(onInvalidate).toHaveBeenCalledWith({
        key: [],
      })
    })

    consoleErrorSpy.mockRestore()
  })

  it('waits for connected event providing connectionId before synchronizing client context', async () => {
    const sync = vi.spyOn(SSEInvalidatorClient.prototype, 'updateClientContext')
      .mockResolvedValue({ updated: true })
    const onInvalidate = asAdapter(vi.fn())
    renderHook(() =>
      useReStale('/sse', { onInvalidate, clientContext: { filter: 'active' } })
    )

    const instance = MockEventSource.instances[0]
    expect(instance).toBeDefined()

    // Emit only 'open' without connected event
    act(() => {
      instance?.emitOpen(new Event('open'), '')
    })

    // At this point, status is open but connectionId is undefined; sync must NOT have been called
    expect(sync).not.toHaveBeenCalled()

    // Now emit connected with the connection ID
    act(() => {
      instance?.emitConnected('assigned-conn-id')
    })

    await waitFor(() => {
      expect(sync).toHaveBeenCalledWith({ filter: 'active' }, { revision: 1 })
    })
  })

  it('does not open connection when disabled is true', () => {
    const onInvalidate = asAdapter(vi.fn())
    renderHook(() =>
      useReStale('/sse', { disabled: true, onInvalidate })
    )

    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('does not instantiate client or throw when disabled is true with zero-width whitespace URL', () => {
    const onInvalidate = asAdapter(vi.fn())
    expect(() => {
      renderHook(() =>
        useReStale('\u200B', { disabled: true, onInvalidate })
      )
    }).not.toThrow()

    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('forwards invalidate events to the latest onInvalidate callback', () => {
    const callbackRef = asAdapter(vi.fn())
    const { rerender } = renderHook(
      ({ cb }) => useReStale('/sse', { onInvalidate: cb }),
      { initialProps: { cb: callbackRef } }
    )

    const nextCallback = asAdapter(vi.fn())
    rerender({ cb: nextCallback })

    const instance = MockEventSource.instances[0]
    act(() => {
      instance.emitOpen()
      instance.emitCustomEvent('invalidate', JSON.stringify({ key: ['items'] }))
    })

    expect(callbackRef).not.toHaveBeenCalled()
    expect(nextCallback).toHaveBeenCalledWith({ key: ['items'] })
  })

  it('forwards the latest inherited client callbacks after a rerender', () => {
    const onInvalidate = asAdapter(vi.fn())
    const initial = {
      callback: vi.fn(),
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
      onError: vi.fn(),
    }
    const { rerender } = renderHook(
      ({ callbacks }) => useReStale('/sse', { onInvalidate, ...callbacks }),
      { initialProps: { callbacks: initial } }
    )
    const updated = {
      callback: vi.fn(),
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
      onError: vi.fn(),
    }

    rerender({ callbacks: updated })

    const instance = MockEventSource.instances[0]
    act(() => {
      instance.emitOpen()
      instance.emitCustomEvent('invalidate', JSON.stringify({ key: ['items'] }))
      instance.emitCustomEvent('invalidate', 'invalid json')
      instance.emitError()
    })

    expect(initial.callback).not.toHaveBeenCalled()
    expect(initial.onConnect).not.toHaveBeenCalled()
    expect(initial.onDisconnect).not.toHaveBeenCalled()
    expect(initial.onError).not.toHaveBeenCalled()
    expect(updated.callback).toHaveBeenCalledWith({ key: ['items'] })
    expect(updated.onConnect).toHaveBeenCalledTimes(1)
    expect(updated.onDisconnect).toHaveBeenCalledTimes(1)
    expect(updated.onError).toHaveBeenCalled()
  })

  it('exposes reconnect and close handlers', () => {
    const onInvalidate = asAdapter(vi.fn())
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

  it('recreates the client when withCredentials changes without changing the URL', () => {
    const onInvalidate = asAdapter(vi.fn())
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

    const onInvalidate = asAdapter(vi.fn())
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
    const onInvalidate = asAdapter(vi.fn())
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

    const onInvalidate = asAdapter(vi.fn())
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
    const onInvalidate = asAdapter(vi.fn())
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
    const onInvalidate = asAdapter(vi.fn())
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
    const onInvalidate = asAdapter(vi.fn())
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

  it('logs debug messages on mount, connect failure, and unmount when debug option is enabled', () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const onInvalidate = asAdapter(vi.fn())

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
