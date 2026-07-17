# Client Guide

The client side connects to your SSE endpoint and translates incoming invalidation signals into cache operations. There are two layers:

1. **`SSEInvalidatorClient`** — framework-agnostic core client (vanilla JS, EventTarget).
2. **`useReStale`** — React hook wrapping the client in `useSyncExternalStore`.

Plus two ready-made cache adapters: **TanStack Query** and **SWR**.

---

## React: `useReStale`

```ts
import { useReStale } from 'restale-kit/react'
```

### Basic usage

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useReStale } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'

function App() {
  const queryClient = useQueryClient()

  const { connection, reconnect, close } = useReStale('/sse', {
    onInvalidate: tanstackAdapter(queryClient),
  })

  return <div>SSE: {connection.status}</div>
}
```

The hook opens the connection on mount and closes it on unmount. Reconnection with exponential backoff is enabled by default.

### Full options

```ts
useReStale(url: string, options: {
  // Required
  onInvalidate: (signal: InvalidateSignal | InvalidateSignal[]) => void

  // Revocation (optional)
  onRevoke?: (reason: string) => void  // called when server sends a terminal revoke frame

  // Connection
  autoReconnect?: boolean       // default true
  withCredentials?: boolean     // default false — send cookies cross-origin
  disabled?: boolean            // default false — skip connection while true

  // Backoff
  reconnect?: {
    baseDelayMs?: number        // default 1_000
    maxDelayMs?: number         // default 30_000
    jitter?: boolean            // default true
    maxRetries?: number         // default Infinity
  }

  // Validation (optional)
  signalSchema?: StandardSchema // validate incoming signals at runtime
})
```

> **Option stability note:** `autoReconnect`, `reconnect`, `signalSchema`, and `withCredentials` are applied only when the `SSEInvalidatorClient` is first created. In the React hook, the client is recreated only when `url` changes — so changing these options on a later render has no effect until the `url` prop also changes.

### Return value

```ts
{
  connectionId: string          // unique ID generated for this SSE connection instance
  connection: ConnectionStatus  // current state
  reconnect(): Promise<void>    // manually reconnect; resets backoff counter
  close(): void                 // manually close
}
```

### `ConnectionStatus` type

```ts
type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
  | { status: 'error'; error: Event }
```

| Reason | When |
|---|---|
| `'manual'` | Caller invoked `close()` |
| `'unmount'` | React component unmounted |
| `'revoked'` | Server sent a terminal `revoke` frame — auto-reconnect is suppressed |

### Server-initiated revocation

When the server calls `channel.revoke()` (e.g. on logout or session expiry), it sends a terminal `revoke` SSE event before closing the stream. The client:

1. Sets status to `{ status: 'closed', reason: 'revoked' }`
2. Suppresses automatic reconnection
3. Calls `onRevoke` with the reason string

```tsx
useReStale('/api/sse', {
  onInvalidate: tanstackAdapter(queryClient),
  onRevoke: (reason) => {
    // Server intentionally closed this connection.
    // reason is e.g. 'logout', 'banned', 'session-expired'
    auth.logout()
  },
})
```

On the server side:

```ts
// Revoke a specific connection (e.g. on logout)
await group.revokeByConnectionId(connectionId, { userId: req.user.id })

// Revoke all connections for a user (e.g. password change)
await group.revokeWhere({ userId: req.user.id })
```

To reconnect after a revocation (e.g. after the user re-authenticates), call `reconnect()` — this resets the revoked flag and opens a fresh connection.

### Conditional connection (e.g. unauthenticated users)

```tsx
const { user } = useAuth()

useReStale('/sse', {
  disabled: !user,              // won't open until user is set
  onInvalidate: tanstackAdapter(queryClient),
})
```

### Connection status UI

```tsx
function SSEStatus() {
  const queryClient = useQueryClient()
  const { connection, reconnect } = useReStale('/sse', {
    onInvalidate: tanstackAdapter(queryClient),
  })

  if (connection.status === 'error') {
    return <button onClick={reconnect}>Reconnect</button>
  }
  if (connection.status === 'closed' && connection.reason === 'revoked') {
    return <span>Session ended by server</span>
  }
  return <span className={`status-${connection.status}`}>{connection.status}</span>
}
```

### Cross-origin with cookies

When your SSE endpoint is on a different origin than your frontend, pass `withCredentials: true`. The server must respond with `Access-Control-Allow-Credentials: true` and a specific (non-`*`) `Access-Control-Allow-Origin`.

```tsx
useReStale('https://api.example.com/sse', {
  withCredentials: true,
  onInvalidate: tanstackAdapter(queryClient),
})
```

---

## Vanilla JS / Non-React: `SSEInvalidatorClient`

For Vue, Svelte, Angular, or plain JavaScript — drive the connection directly.

```ts
import { SSEInvalidatorClient } from 'restale-kit/client'

const client = new SSEInvalidatorClient('/sse', {
  autoReconnect: true,
  withCredentials: false,
  reconnect: {
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitter: true,
    maxRetries: Infinity,
  },
})

// Listen to invalidation signals
client.addEventListener('invalidate', (event) => {
  const signal = event.detail // InvalidateSignal | InvalidateSignal[]
  // call your own cache library here
})

// Handle server-initiated revocation (logout, ban, session expiry)
// The connection is already closed when this fires — do NOT reconnect automatically.
client.addEventListener('revoke', (event) => {
  const { reason } = event.detail // e.g. 'logout', 'banned', 'session-expired'
  console.warn('Connection revoked by server:', reason)
  // e.g. redirect to login, clear session state
})

// Access client properties
console.log('Unique connection ID:', client.connectionId) // e.g. "a1b2c3d4-..."
console.log('Endpoint URL:', client.endpointUrl)          // the URL passed to the constructor
console.log('Last received event ID:', client.lastEventId) // e.g. "100" or null

// Track connection state changes
client.addEventListener('statuschange', (event) => {
  const s = event.detail
  if (s.status === 'closed' && s.reason === 'revoked') {
    // server-initiated — do not auto-reconnect
  } else {
    console.log(s.status) // 'connecting' | 'open' | 'closed' | 'error'
  }
})

// Optionally catch validation errors (when signalSchema is set)
client.addEventListener('error', (event) => {
  console.error('SSE error:', event.detail)
})

await client.connect()

// Manual close (reason: 'manual')
client.close()

// Called by framework wrappers on component unmount (reason: 'unmount')
// Behaves like close() but sets reason to 'unmount' — use close() in non-React code.
// client.closeWithUnmount()
```

### `connect()` behavior by state

| State | `connect()` result |
|---|---|
| `'open'` | No-op, returns resolved promise |
| `'connecting'` (active attempt) | Returns the same pending promise |
| `'connecting'` (backoff) | Cancels the pending retry timer, opens a new connection, resets backoff |
| `'closed'` (manual) | Opens a new connection, resets backoff |
| `'closed'` (unmount) | Same as manual — allows reuse after re-mount |
| `'closed'` (revoked) | Same as manual — resets the revoked flag and opens a fresh connection |
| `'error'` | Cancels pending retry timer, opens a new connection, resets backoff |

---

## TanStack Query adapter

```ts
import { tanstackAdapter } from 'restale-kit/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'
```

`tanstackAdapter(queryClient)` returns an `onInvalidate` callback that maps signals to `queryClient` operations:

```ts
const queryClient = useQueryClient()

useReStale('/sse', {
  onInvalidate: tanstackAdapter(queryClient),
})
```

**Action and filter mapping:**

| Signal field | Type / Values | `queryClient` operation |
|---|---|---|
| `action: 'invalidate'` (default) | `'invalidate'` | `queryClient.invalidateQueries(filters)` (uses `stale` filter if provided) |
| `action: 'refetch'` | `'refetch'` | `queryClient.refetchQueries(filters)` |
| `action: 'reset'` | `'reset'` | `queryClient.resetQueries(filters)` |
| `action: 'remove'` | `'remove'` | `queryClient.removeQueries(filters)` |
| `action: 'cancel'` | `'cancel'` | `queryClient.cancelQueries(filters)` |
| `type` | `'active' \| 'inactive' \| 'all'` | Passed as `filters.type` |
| `stale` | `boolean` | Maps `refetchType` to `'none'` (when `stale: true`) or `'active'` |

Batch signals (arrays) are processed one-by-one in order.

### `useTanstackQueryAdapter` — memoized hook variant

```ts
import { useTanstackQueryAdapter } from 'restale-kit/tanstack-query'
```

Equivalent to `tanstackAdapter(queryClient)` but wrapped in `useCallback` for referential stability across renders. Call it at the top level of your component and pass the result to `useReStale`:

```tsx
function App() {
  const queryClient = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(queryClient) // called as a hook, at top level
  useReStale('/sse', { onInvalidate })
}
```

Note: `useTanstackQueryAdapter` is a React hook — call it unconditionally at the component's top level, not inside a conditional or nested function. If you do not need memoization (e.g. `queryClient` is module-level), use `tanstackAdapter` directly instead.

---

## SWR adapter

```ts
import { swrAdapter, type SWRAdapterOptions } from 'restale-kit/swr'
import { useSWRConfig } from 'swr'
```

`swrAdapter` takes SWR's global `mutate` function (from `useSWRConfig()`) and returns an `onInvalidate` callback:

```tsx
import { useSWRConfig } from 'swr'
import { useReStale } from 'restale-kit/react'
import { swrAdapter } from 'restale-kit/swr'

function App() {
  const { mutate } = useSWRConfig()

  useReStale('/sse', {
    onInvalidate: swrAdapter(mutate),
  })
}
```

**Action and option mapping:**

| Signal field | Values | SWR `mutate` operation |
|---|---|---|
| `action: 'revalidate'` / `'invalidate'` | Default | `mutate(filter)` — revalidates matching keys |
| `action: 'purge'` / `'remove'` | Purge / Remove | `mutate(filter, undefined, false)` — clears cache without revalidating |
| `revalidate: false` | `boolean` | `mutate(filter, undefined, false)` — forces clear without revalidating |
| `match` | `'exact' \| 'prefix'` | For string keys, controls exact vs prefix matching (`key.startsWith(...)`) |


> **Note:** SWR has no separate "mark stale" operation, so `'invalidate'` and `'refetch'` both trigger immediate revalidation.

### SWR key format

By default, the adapter expects SWR keys to be JSON-safe arrays matching the signal's key format — e.g. `['todos', { userId: '42' }]`. Non-array SWR keys are skipped.

If your SWR keys use a different format, provide a `toInvalidateKey` mapping function:

```ts
swrAdapter(mutate, {
  toInvalidateKey: (swrKey, signal) => {
    // Convert your SWR key format to a JSONValue[] for matching
    if (typeof swrKey === 'string') return [swrKey]
    return undefined // skip unrecognized keys
  },
})
```

### `useSwrAdapter` — memoized hook variant

```ts
import { useSwrAdapter } from 'restale-kit/swr'
```

Equivalent to `swrAdapter(mutate, options)` but memoized. The options object is stored in a ref, so changing options on re-render works correctly without breaking referential stability:

```tsx
function App() {
  const { mutate } = useSWRConfig()
  const onInvalidate = useSwrAdapter(mutate) // called as a hook, at top level
  useReStale('/sse', { onInvalidate })
}
```

---

## What the frontend sees on disconnect

When the SSE connection drops, `EventSource.onerror` fires internally. The client tears down the current `EventSource` and dispatches an `'error'` event, then decides what to do based on `autoReconnect` and the retry count.

**With `autoReconnect: true` (default) and retries remaining:**

The status immediately transitions to `{ status: 'connecting' }`, and `statuschange` fires. The client schedules a retry after an exponential backoff delay. Each subsequent attempt also stays in `'connecting'`. The cycle continues until the connection reopens (status → `'open'`) or retries are exhausted.

```text
'open' → 'connecting'   ← disconnect detected
'connecting' → 'connecting'  ← each retry attempt (while waiting / retrying)
'connecting' → 'open'   ← successful reconnect
```

**With `autoReconnect: false`, or when retries are exhausted:**

The status transitions to `{ status: 'error', error: Event }`. No further reconnection is attempted automatically. Call `reconnect()` (hook) or `client.connect()` to try again manually.

```text
'open' → 'error'   ← immediate, no retries
```

**Without an event store, signals fired while the client was offline are not replayed.** See [Reconnection & Event History Replay](./server.md#reconnection--event-history-replay) for the full server-side setup.

---

## Reconnect strategy

When `autoReconnect: true` (default), failed connections retry with exponential backoff + jitter:

```text
delay = min(baseDelayMs × 2^attempt, maxDelayMs)
if jitter: delay = delay × random(0.5, 1.5)
```

- `attempt` resets to 0 on successful `open`.
- Calling `close()` cancels any pending retry timer.
- `reconnect()` from the hook (or `client.connect()`) cancels any active retry timer, resets the backoff counter, and immediately initiates a new connection attempt.
