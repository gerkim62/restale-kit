// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReStale } from './useReStale.js'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'
import { MockEventSource } from '@/test-fixtures/event-source.js'

describe('useReStale', () => {
  let originalEventSource: typeof globalThis.EventSource

  beforeEach(() => {
    originalEventSource = globalThis.EventSource
    MockEventSource.clear()
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
  })

  afterEach(() => {
    globalThis.EventSource = originalEventSource
  })

  it('opens connection on mount and closes on unmount', () => {
    const spy = vi.spyOn(SSEInvalidatorClient.prototype, 'closeWithUnmount')
    const onInvalidate = vi.fn()
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
    spy.mockRestore()
  })

  it('does not open connection when disabled is true', () => {
    const onInvalidate = vi.fn()
    renderHook(() =>
      useReStale('/sse', { disabled: true, onInvalidate })
    )

    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('forwards invalidate events to the latest onInvalidate callback', () => {
    const callbackRef = vi.fn()
    const { rerender } = renderHook(
      ({ cb }) => useReStale('/sse', { onInvalidate: cb }),
      { initialProps: { cb: callbackRef } }
    )

    const nextCallback = vi.fn()
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
    const onInvalidate = vi.fn()
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
})
