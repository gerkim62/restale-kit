import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react'
import { useQuery, useMutation, useQueryClient, QueryClient } from '@tanstack/react-query'

// ════════════════════════════════════════════════════════════════════════════════
// INLINE restale-kit implementation — this is what the library will provide.
// These functions are implemented here to make the example self-contained.
// In production, you'd import from 'restale-kit/react' and 'restale-kit/tanstack-query'.
// ════════════════════════════════════════════════════════════════════════════════

// ── Types (from restale-kit core) ──────────────────────────────────────────────

interface InvalidateSignal {
  key: unknown[]
  exact?: boolean
  action?: 'invalidate' | 'refetch' | 'remove'
}

type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' }
  | { status: 'error'; error: Event }

// ── tanstackAdapter (from restale-kit/tanstack-query) ──────────────────────────

function tanstackAdapter(queryClient: QueryClient) {
  return (signal: InvalidateSignal | InvalidateSignal[]) => {
    const list = Array.isArray(signal) ? signal : [signal]
    for (const s of list) {
      const filters = { queryKey: s.key, exact: s.exact }
      switch (s.action) {
        case 'remove':
          queryClient.removeQueries(filters)
          break
        case 'refetch':
          queryClient.refetchQueries(filters)
          break
        case 'invalidate':
        default:
          queryClient.invalidateQueries(filters)
          break
      }
    }
  }
}

// ── useReStale (from restale-kit/react) ────────────────────────────────────────

interface UseReStaleOptions {
  disabled?: boolean
  onInvalidate?: (signal: InvalidateSignal | InvalidateSignal[]) => void
  autoReconnect?: boolean
  reconnect?: { baseDelayMs?: number; maxDelayMs?: number; jitter?: boolean }
}

interface UseReStaleResult {
  connection: ConnectionStatus
  reconnect: () => void
  close: () => void
  eventCount: number  // bonus: not in spec, just for the demo UI
}

function useReStale(url: string, opts: UseReStaleOptions = {}): UseReStaleResult {
  const {
    disabled = false,
    onInvalidate,
    autoReconnect = true,
    reconnect: reconnectOpts = {},
  } = opts

  const {
    baseDelayMs = 1_000,
    maxDelayMs = 30_000,
    jitter = true,
  } = reconnectOpts

  const statusRef = useRef<ConnectionStatus>({ status: 'closed', reason: 'manual' })
  const listenersRef = useRef(new Set<() => void>())
  const esRef = useRef<EventSource | null>(null)
  const attemptRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const eventCountRef = useRef(0)
  const onInvalidateRef = useRef(onInvalidate)
  onInvalidateRef.current = onInvalidate

  const notify = useCallback(() => {
    for (const listener of listenersRef.current) listener()
  }, [])

  const setStatus = useCallback((s: ConnectionStatus) => {
    statusRef.current = s
    notify()
  }, [notify])

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
    }
    clearTimeout(retryTimerRef.current)

    setStatus({ status: 'connecting' })
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => {
      attemptRef.current = 0
      setStatus({ status: 'open' })
    }

    es.onerror = (event) => {
      setStatus({ status: 'error', error: event })
      es.close()
      esRef.current = null

      if (autoReconnect) {
        const attempt = attemptRef.current++
        let delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
        if (jitter) delay *= 0.5 + Math.random()
        retryTimerRef.current = setTimeout(connect, delay)
      }
    }

    es.addEventListener('invalidate', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        eventCountRef.current++
        notify()
        onInvalidateRef.current?.(data)
      } catch {
        // Malformed payload — spec says emit error, simplified here
      }
    })
  }, [url, autoReconnect, baseDelayMs, maxDelayMs, jitter, setStatus, notify])

  const close = useCallback(() => {
    clearTimeout(retryTimerRef.current)
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setStatus({ status: 'closed', reason: 'manual' })
  }, [setStatus])

  // Connect on mount, close on unmount
  useEffect(() => {
    if (disabled) return
    connect()
    return () => {
      clearTimeout(retryTimerRef.current)
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      statusRef.current = { status: 'closed', reason: 'unmount' }
    }
  }, [disabled, connect])

  // useSyncExternalStore for tear-safe React rendering
  const connection = useSyncExternalStore(
    useCallback((cb) => {
      listenersRef.current.add(cb)
      return () => listenersRef.current.delete(cb)
    }, []),
    () => statusRef.current,
    () => ({ status: 'closed' as const, reason: 'unmount' as const }),
  )

  const eventCount = useSyncExternalStore(
    useCallback((cb) => {
      listenersRef.current.add(cb)
      return () => listenersRef.current.delete(cb)
    }, []),
    () => eventCountRef.current,
    () => 0,
  )

  return { connection, reconnect: connect, close, eventCount }
}

// ════════════════════════════════════════════════════════════════════════════════
// Application code — this is what the user writes.
// ════════════════════════════════════════════════════════════════════════════════

interface Todo {
  id: number
  text: string
  done: boolean
}

export default function App() {
  const queryClient = useQueryClient()
  const [newTodo, setNewTodo] = useState('')
  const [flash, setFlash] = useState(false)

  // ── restale-kit wiring — two lines ─────────────────────────────────────────
  const { connection, reconnect, eventCount } = useReStale('/sse', {
    onInvalidate: tanstackAdapter(queryClient),
  })

  // Flash the todo list when an SSE event arrives
  const prevCountRef = useRef(eventCount)
  useEffect(() => {
    if (eventCount > prevCountRef.current) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 600)
      prevCountRef.current = eventCount
      return () => clearTimeout(t)
    }
  }, [eventCount])

  // ── Queries & Mutations ────────────────────────────────────────────────────

  const { data: todos = [], isLoading, isError } = useQuery<Todo[]>({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then(r => r.json()),
  })

  const addMutation = useMutation({
    mutationFn: (text: string) =>
      fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }),
    // No onSuccess invalidation needed — SSE handles it for ALL tabs
  })

  const toggleMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/todos/${id}`, { method: 'PATCH' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/todos/${id}`, { method: 'DELETE' }),
  })

  const simulateMutation = useMutation({
    mutationFn: () =>
      fetch('/api/simulate-external', { method: 'POST' }),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = newTodo.trim()
    if (!text) return
    setNewTodo('')
    addMutation.mutate(text)
  }

  // ── Status helpers ─────────────────────────────────────────────────────────

  const statusKey = connection.status
  const statusLabels: Record<string, string> = {
    connecting: 'Connecting…',
    open: 'Live',
    closed: 'Disconnected',
    error: 'Connection error',
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header__brand">restale-kit</div>
        <h1 className="header__title">Live Todo Demo</h1>
        <p className="header__subtitle">
          Open this page in two tabs. Mutations in one tab update the other in real time via SSE.
        </p>
      </header>

      {/* Connection Status */}
      <div className="status-bar">
        <span className={`status-dot status-dot--${statusKey}`} />
        <span className="status-label">
          SSE: <strong>{statusLabels[statusKey]}</strong>
        </span>
        {statusKey === 'error' && (
          <button className="add-form__btn" style={{ padding: '6px 14px', fontSize: '0.75rem' }} onClick={reconnect}>
            Retry
          </button>
        )}
        <span className="event-count">{eventCount} event{eventCount !== 1 ? 's' : ''} received</span>
      </div>

      {/* Add Todo */}
      <form className="add-form" onSubmit={handleSubmit}>
        <input
          className="add-form__input"
          type="text"
          value={newTodo}
          onChange={e => setNewTodo(e.target.value)}
          placeholder="Add a todo…"
          disabled={addMutation.isPending}
        />
        <button className="add-form__btn" type="submit" disabled={addMutation.isPending || !newTodo.trim()}>
          {addMutation.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>

      {/* Error */}
      {isError && (
        <div className="error-banner">
          Failed to load todos. Is the server running on port 3001?
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="loading">
          <div className="loading-spinner" />
          <div>Loading todos…</div>
        </div>
      )}

      {/* Todo List */}
      {!isLoading && (
        <div className={`todo-list ${flash ? 'flash' : ''}`}>
          {todos.length === 0 && (
            <div className="empty-state">No todos yet. Add one above!</div>
          )}
          {todos.map(todo => (
            <div key={todo.id} className="todo-item">
              <input
                className="todo-item__checkbox"
                type="checkbox"
                checked={todo.done}
                onChange={() => toggleMutation.mutate(todo.id)}
              />
              <span className={`todo-item__text ${todo.done ? 'todo-item__text--done' : ''}`}>
                {todo.text}
              </span>
              <button
                className="todo-item__delete"
                onClick={() => deleteMutation.mutate(todo.id)}
                aria-label="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="actions">
        <button className="btn-simulate" onClick={() => simulateMutation.mutate()}>
          ⚡ Simulate External Mutation
          <br />
          <small style={{ opacity: 0.6 }}>
            Adds a todo server-side (like a webhook or another service would) — all tabs see it
          </small>
        </button>
      </div>

      {/* Hint */}
      <div className="hint">
        <strong>How it works:</strong> The server broadcasts
        <code>{"{ key: ['todos'] }"}</code> over SSE after every mutation.
        <code>tanstackAdapter</code> calls <code>queryClient.invalidateQueries</code>,
        TanStack Query refetches, and the UI updates. No polling, no manual invalidation,
        no <code>onSuccess</code> callbacks — every tab stays in sync automatically.
      </div>
    </div>
  )
}
