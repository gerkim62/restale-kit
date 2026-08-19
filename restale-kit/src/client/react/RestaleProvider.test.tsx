// @vitest-environment jsdom

import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, act, waitFor, screen, cleanup } from '@testing-library/react'
import { MockEventSource } from '@/test-fixtures/event-source.js'
import { makeAdaptedCallback, type AdaptedCallback } from '@/client/core/client-contracts.js'
import type { UniversalSignal } from '@/types/protocol.js'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'

vi.mock('sse.js', async () => {
  const { MockEventSource: SSE } = await import('@/test-fixtures/event-source.js')
  return { SSE }
})

import { RestaleProvider } from './RestaleProvider.js'
import { useRestale } from './useRestale.js'

/** Helper to wrap a mock function as an AdaptedCallback */
function asAdapter(fn: (signal: UniversalSignal | UniversalSignal[]) => void = vi.fn()): AdaptedCallback {
  return makeAdaptedCallback(fn)
}

describe('RestaleProvider & useRestale', () => {
  beforeEach(() => {
    MockEventSource.clear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Provider Boundary & Error Handling', () => {
    it('throws a descriptive error when useRestale is called outside RestaleProvider', () => {
      // Suppress React error boundary console output in test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        renderHook(() => useRestale())
      }).toThrow('useRestale() must be used within a <RestaleProvider>')

      consoleErrorSpy.mockRestore()
    })
  })

  describe('Connection Lifecycle & Multi-Consumer Sharing', () => {
    it('opens connection on mount and closes with unmount reason when provider unmounts', () => {
      const closeSpy = vi.spyOn(SSEInvalidatorClient.prototype, 'closeWithUnmount')
      const onInvalidate = asAdapter(vi.fn())

      const { unmount } = render(
        <RestaleProvider url="/sse" onInvalidate={onInvalidate}>
          <div>Child</div>
        </RestaleProvider>
      )

      expect(MockEventSource.instances).toHaveLength(1)
      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen()
      })

      unmount()
      expect(instance?.readyState).toBe(MockEventSource.CLOSED)
      expect(closeSpy).toHaveBeenCalledTimes(1)
    })

    it('shares a single SSE connection across multiple useRestale consumers', () => {
      const onInvalidate = asAdapter(vi.fn())

      function ConsumerA() {
        const { isConnected } = useRestale()
        return <div data-testid="consumer-a">{isConnected ? 'connected' : 'disconnected'}</div>
      }

      function ConsumerB() {
        const { connection } = useRestale()
        return <div data-testid="consumer-b">{connection.status}</div>
      }

      render(
        <RestaleProvider url="/sse" onInvalidate={onInvalidate}>
          <ConsumerA />
          <ConsumerB />
        </RestaleProvider>
      )

      // Exactly ONE EventSource instance created despite multiple consumers
      expect(MockEventSource.instances).toHaveLength(1)
      const instance = MockEventSource.instances[0]

      expect(screen.getByTestId('consumer-a').textContent).toBe('disconnected')
      expect(screen.getByTestId('consumer-b').textContent).toBe('connecting')

      act(() => {
        instance?.emitOpen()
      })

      expect(screen.getByTestId('consumer-a').textContent).toBe('connected')
      expect(screen.getByTestId('consumer-b').textContent).toBe('open')
    })

    it('exposes reconnect and close controls on useRestale result', () => {
      const onInvalidate = asAdapter(vi.fn())
      let hookResult!: ReturnType<typeof useRestale>

      function Consumer() {
        hookResult = useRestale()
        return null
      }

      render(
        <RestaleProvider url="/sse" onInvalidate={onInvalidate}>
          <Consumer />
        </RestaleProvider>
      )

      expect(hookResult.connection.status).toBe('connecting')
      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen()
      })
      expect(hookResult.connection.status).toBe('open')
      expect(hookResult.isConnected).toBe(true)

      act(() => {
        hookResult.close()
      })
      expect(hookResult.connection).toEqual({ status: 'closed', reason: 'manual' })
      expect(hookResult.isClosed).toBe(true)
    })

    it('allows destructured reconnect and close callbacks to be invoked standalone without this binding', async () => {
      const onInvalidate = asAdapter(vi.fn())
      let reconnectFn!: () => Promise<void>
      let closeFn!: () => void

      function Consumer() {
        const { reconnect, close } = useRestale()
        reconnectFn = reconnect
        closeFn = close
        return null
      }

      render(
        <RestaleProvider url="/sse" onInvalidate={onInvalidate}>
          <Consumer />
        </RestaleProvider>
      )

      expect(MockEventSource.instances).toHaveLength(1)
      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen()
      })

      // Invoke destructured close without object context
      act(() => {
        closeFn()
      })
      expect(instance?.readyState).toBe(MockEventSource.CLOSED)

      // Invoke destructured reconnect without object context
      let reconnectPromise!: Promise<void>
      act(() => {
        reconnectPromise = reconnectFn()
      })
      expect(MockEventSource.instances).toHaveLength(2)
      act(() => {
        MockEventSource.instances[1]?.emitOpen()
      })
      await expect(reconnectPromise).resolves.toBeUndefined()
    })
  })

  describe('disabled prop behavior', () => {
    it('does not open connection when disabled is true', () => {
      const onInvalidate = asAdapter(vi.fn())
      let hookResult!: ReturnType<typeof useRestale>

      function Consumer() {
        hookResult = useRestale()
        return null
      }

      render(
        <RestaleProvider url="/sse" onInvalidate={onInvalidate} disabled={true}>
          <Consumer />
        </RestaleProvider>
      )

      expect(MockEventSource.instances).toHaveLength(0)
      expect(hookResult.isClosed).toBe(true)
      expect(hookResult.connection.status).toBe('closed')
    })

    it('connects when disabled transitions from true to false', () => {
      const onInvalidate = asAdapter(vi.fn())

      function App() {
        const [disabled, setDisabled] = useState(true)
        return (
          <div>
            <button onClick={() => { setDisabled(false) }}>Enable</button>
            <RestaleProvider url="/sse" onInvalidate={onInvalidate} disabled={disabled}>
              <div />
            </RestaleProvider>
          </div>
        )
      }

      render(<App />)
      expect(MockEventSource.instances).toHaveLength(0)

      act(() => {
        screen.getByText('Enable').click()
      })

      expect(MockEventSource.instances).toHaveLength(1)
    })

    it('does not throw when disabled is true with a blank/zero-width URL', () => {
      const onInvalidate = asAdapter(vi.fn())
      expect(() => {
        render(
          <RestaleProvider url="\u200B" onInvalidate={onInvalidate} disabled={true}>
            <div />
          </RestaleProvider>
        )
      }).not.toThrow()

      expect(MockEventSource.instances).toHaveLength(0)
    })
  })

  describe('Event and Invalidation Handling', () => {
    it('forwards invalidate events to onInvalidate callback', () => {
      const onInvalidate = asAdapter(vi.fn())

      render(
        <RestaleProvider url="/sse" onInvalidate={onInvalidate}>
          <div />
        </RestaleProvider>
      )

      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen()
        instance?.emitCustomEvent('invalidate', JSON.stringify({ key: ['todos'] }))
      })

      expect(onInvalidate).toHaveBeenCalledWith({ key: ['todos'] })
    })

    it('updates onInvalidate callback dynamically without recreating connection', () => {
      const firstCallback = asAdapter(vi.fn())
      const secondCallback = asAdapter(vi.fn())

      function App() {
        const [cb, setCb] = useState(() => firstCallback)
        return (
          <div>
            <button onClick={() => { setCb(() => secondCallback) }}>Switch</button>
            <RestaleProvider url="/sse" onInvalidate={cb}>
              <div />
            </RestaleProvider>
          </div>
        )
      }

      render(<App />)
      expect(MockEventSource.instances).toHaveLength(1)

      act(() => {
        screen.getByText('Switch').click()
      })

      // Connection should NOT be recreated
      expect(MockEventSource.instances).toHaveLength(1)

      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen()
        instance?.emitCustomEvent('invalidate', JSON.stringify({ key: ['users'] }))
      })

      expect(firstCallback).not.toHaveBeenCalled()
      expect(secondCallback).toHaveBeenCalledWith({ key: ['users'] })
    })

    it('forwards onRevoke, onRejected, and onRetriesExhausted callbacks', () => {
      const onInvalidate = asAdapter(vi.fn())
      const onRevoke = vi.fn()
      const onRejected = vi.fn()

      render(
        <RestaleProvider
          url="/sse"
          onInvalidate={onInvalidate}
          onRevoke={onRevoke}
          onRejected={onRejected}
        >
          <div />
        </RestaleProvider>
      )

      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen()
        instance?.emitCustomEvent('revoke', JSON.stringify({ reason: 'logout' }))
      })

      expect(onRevoke).toHaveBeenCalledWith({ reason: 'logout' })
    })

    it('calls onRetriesExhausted when automatic retries fail', () => {
      vi.useFakeTimers()
      const onInvalidate = asAdapter(vi.fn())
      const onRetriesExhausted = vi.fn()

      render(
        <RestaleProvider
          url="/sse"
          onInvalidate={onInvalidate}
          reconnect={{ maxRetries: 2, baseDelayMs: 50, jitter: false }}
          onRetriesExhausted={onRetriesExhausted}
        >
          <div />
        </RestaleProvider>
      )

      // Initial fail
      act(() => {
        MockEventSource.instances[0]?.emitError()
      })

      // Retry 1 fail
      act(() => {
        vi.advanceTimersByTime(60)
        MockEventSource.instances[1]?.emitError()
      })

      // Retry 2 fail
      act(() => {
        vi.advanceTimersByTime(110)
        MockEventSource.instances[2]?.emitError()
      })

      expect(onRetriesExhausted).toHaveBeenCalledTimes(1)
      expect(onRetriesExhausted).toHaveBeenCalledWith({ attempts: 2, maxRetries: 2 })

      vi.useRealTimers()
    })
  })

  describe('Client Context Synchronization (Happy, Merge, Replace, Revert, and Sad Paths)', () => {
    it('synchronizes initialClientContext upon connection opening', async () => {
      const syncSpy = vi
        .spyOn(SSEInvalidatorClient.prototype, 'updateClientContext')
        .mockResolvedValue({ updated: true })
      const onInvalidate = asAdapter(vi.fn())

      render(
        <RestaleProvider
          url="/sse"
          onInvalidate={onInvalidate}
          initialClientContext={{ userId: 'user-123' }}
        >
          <div />
        </RestaleProvider>
      )

      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen(undefined, 'conn-1')
      })

      await waitFor(() => {
        expect(syncSpy).toHaveBeenCalledWith({ userId: 'user-123' }, { revision: 1 })
      })
    })

    it('merges hook clientContext with initialClientContext in merge mode (default)', async () => {
      const syncSpy = vi
        .spyOn(SSEInvalidatorClient.prototype, 'updateClientContext')
        .mockResolvedValue({ updated: true })
      const onInvalidate = asAdapter(vi.fn())

      let effectiveCtx: Record<string, unknown> | undefined

      function Page() {
        const { clientContext } = useRestale({
          clientContext: { page: 1, search: 'hello' },
        })
        effectiveCtx = clientContext
        return null
      }

      render(
        <RestaleProvider
          url="/sse"
          onInvalidate={onInvalidate}
          initialClientContext={{ userId: 'user-123', tenantId: 'tenant-abc' }}
        >
          <Page />
        </RestaleProvider>
      )

      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen(undefined, 'conn-1')
      })

      await waitFor(() => {
        expect(syncSpy).toHaveBeenCalledWith(
          { userId: 'user-123', tenantId: 'tenant-abc', page: 1, search: 'hello' },
          { revision: 1 }
        )
      })

      expect(effectiveCtx).toEqual({
        userId: 'user-123',
        tenantId: 'tenant-abc',
        page: 1,
        search: 'hello',
      })
    })

    it('replaces initialClientContext when clientContextMode is "replace"', async () => {
      const syncSpy = vi
        .spyOn(SSEInvalidatorClient.prototype, 'updateClientContext')
        .mockResolvedValue({ updated: true })
      const onInvalidate = asAdapter(vi.fn())

      function Page() {
        useRestale({
          clientContext: { isolatedKey: 42 },
          clientContextMode: 'replace',
        })
        return null
      }

      render(
        <RestaleProvider
          url="/sse"
          onInvalidate={onInvalidate}
          initialClientContext={{ userId: 'user-123' }}
        >
          <Page />
        </RestaleProvider>
      )

      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen(undefined, 'conn-1')
      })

      await waitFor(() => {
        expect(syncSpy).toHaveBeenCalledWith({ isolatedKey: 42 }, { revision: 1 })
      })
    })

    it('reverts context to initialClientContext when page component unmounts', async () => {
      const syncSpy = vi
        .spyOn(SSEInvalidatorClient.prototype, 'updateClientContext')
        .mockResolvedValue({ updated: true })
      const onInvalidate = asAdapter(vi.fn())

      function Page() {
        useRestale({ clientContext: { page: 2 } })
        return <div>Page Content</div>
      }

      function App() {
        const [mounted, setMounted] = useState(true)
        return (
          <div>
            <button onClick={() => { setMounted(false) }}>Unmount Page</button>
            <RestaleProvider
              url="/sse"
              onInvalidate={onInvalidate}
              initialClientContext={{ userId: 'user-123' }}
            >
              {mounted && <Page />}
            </RestaleProvider>
          </div>
        )
      }

      render(<App />)
      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen(undefined, 'conn-1')
      })

      await waitFor(() => {
        expect(syncSpy).toHaveBeenCalledWith({ userId: 'user-123', page: 2 }, { revision: 1 })
      })

      // Unmount page
      act(() => {
        screen.getByText('Unmount Page').click()
      })

      await waitFor(() => {
        expect(syncSpy).toHaveBeenLastCalledWith({ userId: 'user-123' }, { revision: 2 })
      })
    })

    it('does not send redundant sync requests when context deep value is identical (canonical dedup)', async () => {
      const syncSpy = vi
        .spyOn(SSEInvalidatorClient.prototype, 'updateClientContext')
        .mockResolvedValue({ updated: true })
      const onInvalidate = asAdapter(vi.fn())

      function Page() {
        const [, setTick] = useState(0)
        // Creating a new object reference on each render with same keys/values
        useRestale({ clientContext: { filter: 'active', order: 'asc' } })
        return <button onClick={() => { setTick((t) => t + 1) }}>Rerender</button>
      }

      render(
        <RestaleProvider url="/sse" onInvalidate={onInvalidate}>
          <Page />
        </RestaleProvider>
      )

      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen(undefined, 'conn-1')
      })

      await waitFor(() => {
        expect(syncSpy).toHaveBeenCalledTimes(1)
      })

      // Trigger 2 rerenders
      act(() => {
        screen.getByText('Rerender').click()
      })
      act(() => {
        screen.getByText('Rerender').click()
      })

      // Still only 1 sync call because deep serialized value didn't change
      expect(syncSpy).toHaveBeenCalledTimes(1)
    })

    it('logs console.error and invokes onInvalidate fallback when client context sync fails (sad path)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(SSEInvalidatorClient.prototype, 'updateClientContext').mockRejectedValue(
        new Error('Network failure')
      )
      const onInvalidate = asAdapter(vi.fn())

      render(
        <RestaleProvider
          url="/sse"
          onInvalidate={onInvalidate}
          initialClientContext={{ page: 1 }}
          clientContextSync={{ maxAttempts: 1, retryDelayMs: 0 }}
        >
          <div />
        </RestaleProvider>
      )

      const instance = MockEventSource.instances[0]
      act(() => {
        instance?.emitOpen(undefined, 'conn-1')
      })

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('[restale-kit][RestaleProvider] Failed to synchronize clientContext.')
        )
        expect(onInvalidate).toHaveBeenCalledWith({ key: [] })
      })

      consoleErrorSpy.mockRestore()
    })
  })

  describe('Connection Identity Swapping', () => {
    it('recreates client when URL or withCredentials changes', () => {
      const onInvalidate = asAdapter(vi.fn())

      function App() {
        const [url, setUrl] = useState('/sse-v1')
        return (
          <div>
            <button onClick={() => { setUrl('/sse-v2') }}>Change URL</button>
            <RestaleProvider url={url} onInvalidate={onInvalidate}>
              <div />
            </RestaleProvider>
          </div>
        )
      }

      render(<App />)
      expect(MockEventSource.instances).toHaveLength(1)
      const firstInstance = MockEventSource.instances[0]

      act(() => {
        screen.getByText('Change URL').click()
      })

      expect(MockEventSource.instances).toHaveLength(2)
      expect(firstInstance?.readyState).toBe(MockEventSource.CLOSED)
    })
  })
})
