// @vitest-environment jsdom
/**
 * Regression tests for Issue 9:
 * useReStale must not create a new SSEInvalidatorClient on every render.
 *
 * The fix added a `urlRef` guard so the client constructor is only called
 * when the url actually changes — not on every render pass. This prevents
 * React Strict Mode's double-invocation from orphaning a client instance.
 *
 * Requires jsdom (separate file because vitest environment is per-file).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReStale } from '@/client/react/useReStale.js'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'
import { MockEventSource } from '@/test-fixtures/event-source.js'
import type { AdaptedInvalidateCallback } from '@/client/core/client-contracts.js'

/** Cast a plain function to AdaptedInvalidateCallback for test use. */
function asAdapter(fn: (...args: any[]) => any): AdaptedInvalidateCallback<'swr'> {
  return fn as unknown as AdaptedInvalidateCallback<'swr'>
}

describe('Issue 9 — useReStale does not orphan clients on repeated renders', () => {
  beforeEach(() => {
    MockEventSource.clear()
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('creates exactly one client per URL — not one per render', () => {
    const onInvalidate = asAdapter(vi.fn())
    const connectionIds = new Set<string>()

    const { result, rerender } = renderHook(() => {
      const r = useReStale('/api/sse', { onInvalidate })
      connectionIds.add(r.connectionId)
      return r
    })

    // Re-render twice more with the same URL
    rerender()
    rerender()

    // Only one unique connectionId was ever produced — no orphaned second client
    expect(connectionIds.size).toBe(1)

    act(() => { result.current.close() })
  })

  it('creates a new client (new connectionId) only when the URL changes', () => {
    const onInvalidate = asAdapter(vi.fn())
    let url = '/api/sse-v1'

    const { result, rerender } = renderHook(() =>
      useReStale(url, { onInvalidate })
    )

    const idBefore = result.current.connectionId

    // Change the URL — this should create a new client with a different connectionId
    url = '/api/sse-v2'
    rerender()

    const idAfter = result.current.connectionId
    expect(idAfter).not.toBe(idBefore)

    act(() => { result.current.close() })
  })

  it('does not create a new EventSource on every re-render (same URL)', () => {
    const onInvalidate = asAdapter(vi.fn())

    const { rerender } = renderHook(() =>
      useReStale('/api/sse', { onInvalidate })
    )

    const instancesAfterMount = MockEventSource.instances.length

    rerender()
    rerender()
    rerender()

    // No additional EventSource instances created by re-renders
    expect(MockEventSource.instances.length).toBe(instancesAfterMount)
  })

  it('closes the old client after commit when the URL changes (deferred to effect)', () => {
    const closeSpy = vi.spyOn(SSEInvalidatorClient.prototype, 'close')
    const onInvalidate = asAdapter(vi.fn())
    let url = '/api/sse-a'

    const { rerender, unmount } = renderHook(() =>
      useReStale(url, { onInvalidate })
    )

    expect(closeSpy).not.toHaveBeenCalled()

    // The close happens in a useEffect after commit, not during render.
    // act() flushes the effects synchronously in the test environment.
    act(() => {
      url = '/api/sse-b'
      rerender()
    })

    expect(closeSpy).toHaveBeenCalledTimes(1)

    unmount()
  })
})
