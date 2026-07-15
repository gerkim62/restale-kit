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
  | { status: 'closed'; reason: 'manual' | 'unmount' }
  | { status: 'error'; error: Event }
```

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

// Access client properties
console.log('Unique connection ID:', client.connectionId) // e.g. "a1b2c3d4-..."
console.log('Last received event ID:', client.lastEventId) // e.g. "100" or null

// Track connection state changes
client.addEventListener('statuschange', (event) => {
  console.log(event.detail.status) // 'connecting' | 'open' | 'closed' | 'error'
})

// Optionally catch validation errors (when signalSchema is set)
client.addEventListener('error', (event) => {
  console.error('SSE error:', event.detail)
})

await client.connect()

// Later
client.close()
```

### `connect()` behavior by state

| State | `connect()` result |
|---|---|
| `'open'` | No-op, returns resolved promise |
| `'connecting'` | Returns the same pending promise (does not start a second connection) |
| `'closed'` (manual) | Opens a new connection, resets backoff |
| `'closed'` (unmount) | Same as manual — allows reuse after re-mount |
| `'error'` | Cancels pending retry timer, opens a new connection, resets backoff |
| `'error'` + autoReconnect actively backing off | Cancels the pending retry timer, immediately attempts, resets backoff |

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

**Action mapping:**

| Signal `action` | `queryClient` call |
|---|---|
| `'invalidate'` (default) | `queryClient.invalidateQueries({ queryKey, exact })` |
| `'refetch'` | `queryClient.refetchQueries({ queryKey, exact })` |
| `'remove'` | `queryClient.removeQueries({ queryKey, exact })` |

Batch signals (arrays) are processed one-by-one in order.

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

**Action mapping:**

| Signal `action` | SWR call |
|---|---|
| `'invalidate'` (default) | `mutate(filter)` — revalidate matching keys |
| `'refetch'` | `mutate(filter)` — revalidate matching keys |
| `'remove'` | `mutate(filter, undefined, false)` — clear without revalidate |

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
