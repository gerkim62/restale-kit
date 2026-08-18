# Client Guide

The client side connects to your SSE endpoint and translates incoming invalidation signals into cache operations. There are two layers:

1. **`RestaleProvider` & `useRestale`** — React provider and consumer hook wrapping the client in `useSyncExternalStore`.
2. **`SSEInvalidatorClient`** — framework-agnostic core client (vanilla JS, EventTarget).

Plus two ready-made cache adapters: **TanStack Query** and **SWR**.

---

## React: `RestaleProvider` & `useRestale`

```ts
import { RestaleProvider, useRestale } from 'restale-kit/react'
```

### Basic usage

Wrap your component tree once at the root with `<RestaleProvider>`, and consume connection status or controls anywhere with `useRestale()`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RestaleProvider, useRestale } from 'restale-kit/react'
import { tanstackQueryAdapter } from 'restale-kit/tanstack-query'

const queryClient = new QueryClient()
const onInvalidate = tanstackQueryAdapter(queryClient)

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RestaleProvider url="/sse" onInvalidate={onInvalidate}>
        <Dashboard />
      </RestaleProvider>
    </QueryClientProvider>
  )
}

function Dashboard() {
  const { isConnected, connection, reconnect } = useRestale()

  return (
    <div>
      <span>SSE: {connection.status}</span>
      {!isConnected && <button onClick={reconnect}>Reconnect</button>}
    </div>
  )
}
```

The provider opens a single SSE connection on mount and closes it when unmounted. Reconnection with exponential backoff is enabled by default. Multiple child components calling `useRestale()` share the exact same connection without opening duplicate streams.

### `RestaleProvider` props

```tsx
<RestaleProvider
  // Required
  url="/api/sse"
  // An AdaptedCallback returned by tanstackQueryAdapter, swrAdapter, or makeAdaptedCallback
  onInvalidate={onInvalidate}

  // Revocation & Errors (optional)
  onRevoke={(detail) => { /* called on terminal revoke frame */ }}
  onRejected={(response) => { /* called for configured non-retryable HTTP status */ }}
  onRetriesExhausted={(detail) => { /* called when retry budget exhausts */ }}
  onConnect={(event) => {}}
  onDisconnect={(event) => {}}
  onError={(error) => {}}

  // Connection options (optional)
  autoReconnect={true} // boolean | { native?: boolean; jsBackoff?: boolean }
  withCredentials={false} // send cookies cross-origin
  disabled={false} // skip connection while true
  debug={false} // enable console logging

  // Client context defaults (optional)
  clientContextDefaults={{ userId: user?.id, tenantId: 'acme' }}
  clientContextUrl="/api/sse" // defaults to url
  clientContextSync={{
    maxAttempts: 2,
    retryDelayMs: 200,
    onExhausted: 'retryOnNextChange',
  }}

  // Backoff options (optional)
  reconnect={{
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    jitter: true,
    maxRetries: Infinity,
    nonRetryableStatuses: [401, 403, 404],
    retryAfter: 'ignore',
  }}
>
  <App />
</RestaleProvider>
```

### Client context & Dynamic Page Context

Use `clientContextDefaults` on `<RestaleProvider>` for static connection-level data (e.g. `userId`), and `useRestale({ clientContext })` in page components for dynamic view state (e.g. `page`, `search`, `filters`):

```tsx
// Deep page component (e.g. in Next.js App Router)
function TodosPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')

  // Shallow-merges with clientContextDefaults:
  // Effective context sent to server: { userId: '123', page: 1, search: '' }
  const { isConnected, clientContext } = useRestale({
    clientContext: { page, search },
  })

  return (
    <div>
      <SearchBar onSearch={setSearch} />
      <TodoList />
    </div>
  )
}
```

- **Merge Mode (Default)**: Shallow-merges `{ ...clientContextDefaults, ...hookContext }`.
- **Replace Mode**: Pass `clientContextMode: 'replace'` to completely override defaults.
- **Unmount Reversion**: When a component supplying `clientContext` unmounts, the context automatically reverts to `clientContextDefaults`.
- **Deduplication**: Deep canonical JSON comparison ensures only actual value changes trigger a server sync.

### `useRestale` return value

```ts
const {
  connectionId,    // string | undefined — unique connection ID assigned by server
  connection,      // ConnectionSnapshot ({ status, reason, connectionId })
  attempt,         // number — current reconnection attempt count
  isConnecting,    // boolean — connecting before retry
  isConnected,     // boolean — stream is open
  isReconnecting,  // boolean — connecting after a failed attempt
  isClosed,        // boolean — closed state
  isError,         // boolean — retry budget exhausted or retries disabled
  reconnect,       // () => Promise<void> — manually trigger reconnect
  close,           // () => void — manually close connection
  clientContext,   // TEffective — current effective client context
} = useRestale()
```

---

## TanStack Query adapter

```ts
import { tanstackQueryAdapter } from 'restale-kit/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'
```

`tanstackQueryAdapter(queryClient, options?)` is a plain function returning an `AdaptedCallback` that maps universal signals to `queryClient` operations:

```ts
const queryClient = new QueryClient()
const onInvalidate = tanstackQueryAdapter(queryClient)

<RestaleProvider url="/sse" onInvalidate={onInvalidate}>
  <App />
</RestaleProvider>
```

**Key transformation:**
Pass `toQueryKey: (key: CacheKey) => QueryKey` in options if you need to prepend a namespace or transform the universal key array:

```ts
const onInvalidate = tanstackQueryAdapter(queryClient, {
  toQueryKey: (key) => ['api', ...key],
})
```

---

## SWR adapter

```ts
import { swrAdapter } from 'restale-kit/swr'
import { mutate } from 'swr'
```

`swrAdapter(mutate, options?)` takes SWR's global `mutate` function and returns an `AdaptedCallback`:

```tsx
import { mutate } from 'swr'
import { RestaleProvider } from 'restale-kit/react'
import { swrAdapter } from 'restale-kit/swr'

const onInvalidate = swrAdapter(mutate)

function Root() {
  return (
    <RestaleProvider url="/sse" onInvalidate={onInvalidate}>
      <App />
    </RestaleProvider>
  )
}
```

---

## Vanilla JS: `SSEInvalidatorClient`

For non-React applications or background workers:

```ts
import { SSEInvalidatorClient } from 'restale-kit/client'
import { tanstackQueryAdapter } from 'restale-kit/tanstack-query'

const client = new SSEInvalidatorClient('/sse', {
  autoReconnect: true,
  callback: tanstackQueryAdapter(queryClient),
})

await client.connect()
```
