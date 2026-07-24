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
import { useTanstackQueryAdapter } from 'restale-kit/tanstack-query'

function App() {
  const queryClient = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(queryClient)

  const { connection, reconnect, close } = useReStale('/sse', { onInvalidate })

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
  onRevoke?: (detail: RevokeEventDetail) => void  // called when server sends a terminal revoke frame
  onRejected?: (response: RejectedConnectionResponse) => void // called for a configured terminal HTTP status

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
    nonRetryableStatuses?: number | '4xx' | '5xx' | { from: number, to: number }
    retryAfter?: 'respect' | 'ignore' // default 'ignore'
  }

  // Target (optional)
  target?: SignalTarget         // optional — overrides the target inferred from the adapter brand (must be type-compatible)
})
```

> **Option stability note:** `autoReconnect`, `reconnect`, `target`, and `withCredentials` are applied only when the `SSEInvalidatorClient` is first created. In the React hook, the client is recreated only when `url` changes — so changing these options on a later render has no effect until the `url` prop also changes.
>
> **Target auto-inference:** When you pass `onInvalidate` from `useTanstackQueryAdapter` or `useSwrAdapter`, the `target` is inferred automatically — you do not need to set it explicitly. The adapter's brand (e.g. `'swr'`) is read at runtime and used to append `__restale_target__` to the SSE URL, enabling server-side signal filtering. You can still pass an explicit `target` to override it, provided it is type-compatible with the adapter's branded target.

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
  | { status: 'closed'; reason: 'rejected'; response: { status: number, headers: Record<string, string[]> } }
  | { status: 'error'; error: Event }
```

| Reason | When |
|---|---|
| `'manual'` | Caller invoked `close()` |
| `'unmount'` | React component unmounted |
| `'revoked'` | Server sent a terminal `revoke` frame — auto-reconnect is suppressed |
| `'rejected'` | The HTTP handshake returned a configured non-retryable status — auto-reconnect is suppressed |

### Stop retrying rejected HTTP handshakes

The client uses `sse.js` internally, so it can inspect an SSE handshake's HTTP status. Configure statuses that should be terminal instead of consuming the reconnect budget:

```ts
useReStale('/sse', {
  onInvalidate,
  reconnect: {
    nonRetryableStatuses: [401, 403, 404, '4xx'],
  },
  onRejected: ({ status }) => {
    if (status === 401 || status === 403) auth.logout()
  },
})
```

Each matcher can be an exact status (`401`), a status class (`'4xx'`), or an inclusive range (`{ from: 400, to: 499 }`). The default is no matches, preserving normal retry behaviour. A rejected handshake sets the connection to `{ status: 'closed', reason: 'rejected' }` and calls `onRejected`; it is distinct from a server-sent `revoke` frame.

For retryable responses such as `429` or `503`, set `retryAfter: 'respect'` to use the server's `Retry-After` header for the next retry. It accepts either delay seconds or an HTTP-date; invalid or absent values fall back to normal exponential backoff.

### Server-initiated revocation

When the server calls `channel.revoke()` (e.g. on logout or session expiry), it sends a terminal `revoke` SSE event before closing the stream. The client:

1. Sets status to `{ status: 'closed', reason: 'revoked' }`
2. Suppresses automatic reconnection
3. Calls `onRevoke` with a `RevokeEventDetail` object

```tsx
useReStale('/api/sse', {
  onInvalidate,
  onRevoke: (detail) => {
    if (detail.reason === 'unsupported-target') {
      // Server doesn't support the requested target
      console.warn('Unsupported target. Server supports:', detail.supported)
    } else {
      // e.g. 'logout', 'banned', 'session-expired'
      auth.logout()
    }
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

### Connection Renewal on Deadline (Frame Guard)

When the server has a connection deadline (e.g., tied to an authentication token's expiry), it sends a `renew` SSE event frame before the deadline fires. The client must then make confirmatory reconnect attempt(s) through your server's real authentication middleware, allowing the server to validate or refresh the session. The number of attempts is controlled by the `maxAttempts` field in the renew frame (default: 1).

The `renew` event includes:
- `reason: 'deadline'` — signals this is a server-initiated renewal (not a transient error)
- `maxAttempts` — how many times to retry if the reconnect fails (typically 1 for strict auth)
- `retryDelayMs` — milliseconds to wait between retry attempts

The client automatically handles this flow:

```ts
client.addEventListener('renew', (event) => {
  const { reason, maxAttempts, retryDelayMs } = event.detail
  console.log('Server requesting renewal:', { reason, maxAttempts, retryDelayMs })
  // Client will make exactly maxAttempts confirmatory reconnect attempts
  // at retryDelayMs intervals. On success, the session is renewed.
  // On exhaustion, the connection closes with reason: 'revoked'.
})
```

If the confirmatory reconnect succeeds, the connection resumes normally. If all attempts fail, the client closes with `{ status: 'closed', reason: 'revoked' }`.

**Without server-side event history**, a momentary gap between the `renew` frame and the client's reconnect attempt may cause the client to miss recent invalidation signals. To avoid this, pair `lifetime` with a shared server-side `eventStore` (see [Reconnection & Event History Replay](./server.md#reconnection--event-history-replay)) so the client can replay missed history on reconnect.

### Conditional connection (e.g. unauthenticated users)

```tsx
const { user } = useAuth()

useReStale('/sse', {
  disabled: !user,              // won't open until user is set
  onInvalidate,
})
```

### Connection status UI

```tsx
function SSEStatus() {
  const queryClient = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(queryClient)
  const { connection, reconnect } = useReStale('/sse', { onInvalidate })

  if (connection.status === 'error') {
    return <button onClick={() => void reconnect()}>Reconnect</button>
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
  onInvalidate,
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

// Handle connection renewal on deadline (Frame Guard)
// The server is asking the client to reconnect through auth once more to validate/refresh session.
client.addEventListener('renew', (event) => {
  const { reason, maxAttempts, retryDelayMs } = event.detail
  console.log('Server requesting renewal:', { reason, maxAttempts, retryDelayMs })
  // Client will automatically make exactly maxAttempts confirmatory reconnect attempts
  // at retryDelayMs intervals. You typically do not need to take action here;
  // on success the session resumes, on exhaustion the connection closes with reason: 'revoked'.
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

// Catch transport / parse errors
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
| `'closed'` (revoked) | Resets the revoked flag and opens a fresh connection; resets backoff |
| `'error'` | Cancels pending retry timer, opens a new connection, resets backoff |

---

## TanStack Query adapter

```ts
import { tanstackQueryAdapter, useTanstackQueryAdapter } from 'restale-kit/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'
```

`tanstackQueryAdapter(queryClient)` returns an `onInvalidate` callback that maps signals to `queryClient` operations:

```ts
const queryClient = useQueryClient()
const onInvalidate = useTanstackQueryAdapter(queryClient)

useReStale('/sse', { onInvalidate })
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

Equivalent to `tanstackQueryAdapter(queryClient)` but wrapped in `useCallback` for referential stability across renders. Call it at the top level of your component and pass the result to `useReStale`:

```tsx
function App() {
  const queryClient = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(queryClient) // called as a hook, at top level
  useReStale('/sse', { onInvalidate })
}
```

Note: `useTanstackQueryAdapter` is a React hook — call it unconditionally at the component's top level, not inside a conditional or nested function. If you do not need React hook memoization (e.g. outside React), use `tanstackQueryAdapter` directly instead.

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
| `action: 'purge'` / `'remove'` | Purge / Remove | `mutate(filter, undefined, { revalidate: false })` — clears cache without revalidating |
| `revalidate: false` | `boolean` | `mutate(filter, undefined, { revalidate: false })` — forces clear without revalidating |
| `match` | `'exact' \| 'prefix'` | For string keys, controls exact vs prefix matching (`key.startsWith(...)`) |


> **Note:** SWR has no separate "mark stale" operation, so `'invalidate'` and `'refetch'` both trigger immediate revalidation.

### SWR key format

The adapter supports two key formats natively:

- **Array keys** — JSON-safe arrays matching the signal's key format, e.g. `['todos', { userId: '42' }]`. This is the default for most setups.
- **Scalar string keys** — plain strings like `'/api/user'`. When the signal's `key` is a string, the adapter matches against string cache keys using exact or prefix comparison (controlled by `match`), and also matches single-element array keys like `['/api/user']`.

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

When the SSE connection drops, the `sse.js` transport emits an error internally. The client owns the retry schedule so it can inspect each HTTP handshake before deciding whether to retry.

- **Mid-stream network drops**: a fresh stream is scheduled with the configured exponential backoff. `Last-Event-ID` is retained and sent on the next request, so server event history can replay the gap.
- **Initial connection failures or HTTP errors**: the same managed backoff applies, unless the status matches `nonRetryableStatuses`, in which case the client closes as `'rejected'` immediately.

**With `autoReconnect: true` (default):**

The status transitions to `{ status: 'connecting' }`, and `statuschange` fires. The managed backoff attempts a fresh stream. Every retry consumes from `maxRetries`; the cycle continues until the connection reopens (status → `'open'`) or retries are exhausted.

```text
'open' → 'connecting'   ← disconnect detected
'connecting' → 'connecting'  ← each retry attempt (while waiting / retrying)
'connecting' → 'open'   ← successful reconnect
```

**With `autoReconnect: false`, or when retries are exhausted:**

The status transitions to `{ status: 'error', error: Event }`. All automatic background reconnect attempts (both native browser `EventSource` reconnects and JavaScript backoff retries) are suppressed. However, manual reconnection via `reconnect()` (hook) or `client.connect()` remains enabled and can be called explicitly at any time.

```text
'open' → 'error'   ← immediate, no automatic retries (manual reconnect() still permitted)
```

**Granular retry control (`autoReconnect: { native?: boolean, jsBackoff?: boolean }`):**

To independently control native browser mid-stream reconnects vs. JavaScript backoff retries, pass an object to `autoReconnect`:

```ts
// Example: Disable native browser auto-reconnect, force JS exponential backoff on drops
useReStale('/sse', {
  autoReconnect: { native: false, jsBackoff: true },
})

// Example: Allow native browser reconnects, but do NOT retry initial/fatal failures via JS
useReStale('/sse', {
  autoReconnect: { native: true, jsBackoff: false },
})
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
