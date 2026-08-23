// @vitest-environment jsdom
/**
 * Regression Test: RestaleProvider Stable Client Instance Across Re-renders
 *
 * RestaleProvider must not create a new SSEClient on every render.
 *
 * The provider guards client creation by checking connection identity (url, withCredentials, clientContextUrl)
 * so the client constructor is only called when connection identity actually changes — not on every render pass.
 *
 * Requires jsdom (separate file because vitest environment is per-file).
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { MockEventSource } from '@/test-fixtures/event-source.js'
import { makeInvalidationHandler, type InvalidationHandler } from '@/client/core/client-contracts.js'
import type { Signal } from '@/types/protocol.js'

vi.mock('sse.js', async () => {
  const { MockEventSource: SSE } = await import('@/test-fixtures/event-source.js')
  return { SSE }
})

import { RestaleProvider } from '@/client/react/RestaleProvider.js'
import { useRestale } from '@/client/react/useRestale.js'
import { SSEClient } from '@/client/core/sse-client.js'

/** Cast a plain function to InvalidationHandler for test use. */
function asAdapter(fn: (signal: Signal | Signal[]) => void = vi.fn()): InvalidationHandler {
  return makeInvalidationHandler(fn)
}

describe('Issue 9 — RestaleProvider does not orphan clients on repeated renders', () => {
  beforeEach(() => {
    MockEventSource.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('creates exactly one client per URL — not one per render', () => {
    const onInvalidate = asAdapter(vi.fn())
    const connectionIds = new Set<string>()

    function Consumer() {
      const r = useRestale()
      connectionIds.add(r.connectionId)
      return null
    }

    const { rerender, unmount } = render(
      <RestaleProvider url="/api/sse" onInvalidate={onInvalidate}>
        <Consumer />
      </RestaleProvider>
    )

    // Re-render twice more with the same URL
    rerender(
      <RestaleProvider url="/api/sse" onInvalidate={onInvalidate}>
        <Consumer />
      </RestaleProvider>
    )
    rerender(
      <RestaleProvider url="/api/sse" onInvalidate={onInvalidate}>
        <Consumer />
      </RestaleProvider>
    )

    // Only one unique client was created
    expect(MockEventSource.instances.length).toBe(1)
    unmount()
  })

  it('creates a new client only when the URL changes', () => {
    const onInvalidate = asAdapter(vi.fn())
    let currentId = ''

    function Consumer() {
      const r = useRestale()
      currentId = r.connectionId
      return null
    }

    const { rerender, unmount } = render(
      <RestaleProvider url="/api/sse-v1" onInvalidate={onInvalidate}>
        <Consumer />
      </RestaleProvider>
    )

    act(() => {
      MockEventSource.instances[0]?.emitOpen(undefined, 'conn-v1')
    })
    expect(currentId).toBe('conn-v1')

    // Change the URL — this should create a new client
    rerender(
      <RestaleProvider url="/api/sse-v2" onInvalidate={onInvalidate}>
        <Consumer />
      </RestaleProvider>
    )

    act(() => {
      MockEventSource.instances[1]?.emitOpen(undefined, 'conn-v2')
    })
    expect(currentId).toBe('conn-v2')
    expect(currentId).not.toBe('conn-v1')

    unmount()
  })

  it('closes the old client after commit when the URL changes (deferred to effect)', () => {
    const closeSpy = vi.spyOn(SSEClient.prototype, 'close')
    const onInvalidate = asAdapter(vi.fn())

    const { rerender, unmount } = render(
      <RestaleProvider url="/api/sse-a" onInvalidate={onInvalidate}>
        <div />
      </RestaleProvider>
    )

    expect(closeSpy).not.toHaveBeenCalled()

    act(() => {
      rerender(
        <RestaleProvider url="/api/sse-b" onInvalidate={onInvalidate}>
          <div />
        </RestaleProvider>
      )
    })

    expect(closeSpy).toHaveBeenCalledTimes(1)
    unmount()
  })
})
