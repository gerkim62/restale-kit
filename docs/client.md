# Client Guide

The client package handles connecting to the server SSE stream, reconnecting on network drops with exponential backoff, and invoking cache updates when invalidation signals arrive.

---

## 1. `useReStale` (React Hook)

`useReStale` binds an SSE connection to a React component lifecycle using `useSyncExternalStore`.

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useReStale } from 'restale-kit/react'
import { useTanstackQueryAdapter } from 'restale-kit/tanstack-query'

function App() {
  const queryClient = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(queryClient)

  const { isConnected, connection } = useReStale('/api/sse', { onInvalidate })

  return <div>Status: {connection.status} (Connected: {String(isConnected)})</div>
}
```

### Options Table

| Option | Type | Default | Description |
|---|---|---|---|
| `onInvalidate` | `AdaptedInvalidateCallback` | **Required** | The branded adapter callback (e.g. from `useTanstackQueryAdapter` or `useSwrAdapter`). |
| `target` | `SignalTarget` | Inferred | Explicit target discriminator override. Must be type-compatible with `onInvalidate`. |
| `disabled` | `boolean` | `false` | When `true`, postpones establishing an SSE connection. |
| `withCredentials` | `boolean` | `false` | Sends cookies and auth headers with cross-origin SSE requests. See [Security Guide](./security.md). |
| `autoReconnect` | `boolean \| AutoReconnectOptions` | `true` | Controls automatic reconnection. Supports granular object `{ native?: boolean; jsBackoff?: boolean }`. |
| `reconnect` | `ReconnectOptions` | See below | Exponential backoff options (`baseDelayMs: 1000`, `maxDelayMs: 30000`, `jitter: true`, `maxRetries: Infinity`). |
| `debug` | `boolean` | `false` | Enables detailed lifecycle console logging. |
| `onRevoke` | `(detail: RevokeEventDetail) => void` | `undefined` | Callback invoked when the server sends a terminal revocation frame. |
| `onRejected` | `(res: RejectedConnectionResponse) => void` | `undefined` | Callback invoked when the handshake returns a non-retryable HTTP status. |
| `onRetriesExhausted` | `(detail: { attempts: number; maxRetries: number }) => void` | `undefined` | Callback invoked when reconnection fails permanently after exhausting retries. |

### Return Value Table

| Property | Type | Description |
|---|---|---|
| `connectionId` | `string` | Unique client-generated correlation UUID sent as `__restale_cid__`. |
| `connection` | `ConnectionStatus` | Discriminated union of the current connection state. |
| `attempt` | `number` | Active retry attempt counter (0 during initial connection or after successful open). |
| `isConnecting` | `boolean` | `true` when `status === 'connecting'` and `attempt === 0`. |
| `isConnected` | `boolean` | `true` when `status === 'open'`. |
| `isReconnecting` | `boolean` | `true` when `status === 'connecting'` and `attempt > 0`. |
| `isClosed` | `boolean` | `true` when `status === 'closed'`. |
| `isError` | `boolean` | `true` when `status === 'error'`. |
| `reconnect()` | `() => Promise<void>` | Manually triggers reconnection and resets the backoff counter. |
| `close()` | `() => void` | Manually closes the active stream connection. |

### Lifecycle & Reactivity Notes

- **Connection Identity Options** (`url`, `target`, `withCredentials`): Changing any of these values creates a new `SSEInvalidatorClient` instance and opens a new stream.
- **Runtime Configuration Options** (`autoReconnect`, `reconnect`, `debug`): Updating these properties updates the active client instance without closing or reconnecting the stream.
- **Unmount Handling**: When the component unmounts, the connection closes with `{ status: 'closed', reason: 'unmount' }`.

---

## 2. `SSEInvalidatorClient` (Vanilla JS)

`SSEInvalidatorClient` is a framework-agnostic client extending `EventTarget`.

```ts
import { SSEInvalidatorClient } from 'restale-kit/client'

const client = new SSEInvalidatorClient('/api/sse', {
  target: 'tanstack-query',
  autoReconnect: true,
})

client.addEventListener('invalidate', (event) => {
  console.log('Invalidation signal received:', event.detail)
})

client.addEventListener('statuschange', (event) => {
  console.log('Connection status changed:', event.detail)
})

void client.connect()
```

### Event Types

| Event Name | Detail Type | Description |
|---|---|---|
| `invalidate` | `CustomEvent<TSignal \| TSignal[]>` | Emitted when valid invalidation signal(s) arrive over SSE. |
| `statuschange` | `CustomEvent<ConnectionStatus>` | Emitted whenever the connection status changes. |
| `error` | `CustomEvent<Event>` | Emitted on connection errors or structural validation failures. |
| `rejected` | `CustomEvent<RejectedConnectionResponse>` | Emitted when an HTTP handshake returns a non-retryable status code. |
| `revoke` | `CustomEvent<RevokeEventDetail>` | Emitted when the server issues a terminal `revoke` frame. |
| `renew` | `CustomEvent<RenewEventDetail>` | Emitted when a server deadline requests a confirmatory reconnect attempt. |
| `retriesexhausted` | `CustomEvent<{ attempts: number; maxRetries: number }>` | Emitted when backoff retries are completely exhausted. |

### Methods

- `connect(): Promise<void>` — Opens the SSE connection stream.
- `close(): void` — Closes the stream with `{ status: 'closed', reason: 'manual' }`.
- `updateRuntimeOptions(opts)` — Dynamically updates runtime options (`autoReconnect`, `reconnect`, `debug`).

---

## 3. TanStack Query Adapter

### `useTanstackQueryAdapter(queryClient)`
React hook returning a stable, branded `onInvalidate` callback for TanStack Query.

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useTanstackQueryAdapter } from 'restale-kit/tanstack-query'
import { useReStale } from 'restale-kit/react'

function Component() {
  const queryClient = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(queryClient)
  useReStale('/api/sse', { onInvalidate })
}
```

### `tanstackQueryAdapter(queryClient)`
Vanilla JS adapter function.

```ts
import { tanstackQueryAdapter } from 'restale-kit/tanstack-query'

const onInvalidate = tanstackQueryAdapter(queryClient)
client.addEventListener('invalidate', (e) => onInvalidate(e.detail))
```

---

## 4. SWR Adapter

### `useSwrAdapter(mutate, options?)`
React hook returning a stable, branded `onInvalidate` callback for SWR.

```tsx
import { useSWRConfig } from 'swr'
import { useSwrAdapter } from 'restale-kit/swr'
import { useReStale } from 'restale-kit/react'

function Component() {
  const { mutate } = useSWRConfig()
  const onInvalidate = useSwrAdapter(mutate)
  useReStale('/api/sse', { onInvalidate })
}
```

### `swrAdapter(mutate, options?)`
Vanilla JS adapter function.

```ts
import { swrAdapter } from 'restale-kit/swr'

const onInvalidate = swrAdapter(mutate)
client.addEventListener('invalidate', (e) => onInvalidate(e.detail))
```

---

## 5. RTK Query Adapter

### `useRtkQueryAdapter(dispatch, api)` / `rtkQueryAdapter(dispatch, api)`
Adapter for Redux Toolkit Query invalidating provided cache tags.

```ts
import { rtkQueryAdapter } from 'restale-kit/rtk-query'

const onInvalidate = rtkQueryAdapter(store.dispatch, api)
```

---

## 6. Custom Adapter

Create custom callbacks using `makeAdaptedCallback`:

```ts
import { makeAdaptedCallback } from 'restale-kit/client'

const customAdapter = makeAdaptedCallback('generic', (signal) => {
  console.log('Handling custom signal:', signal)
})
```

---

## 7. Connection Status (`ConnectionStatus`)

`ConnectionStatus` is a discriminated union describing all connection lifecycle states:

```ts
type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
  | { status: 'closed'; reason: 'rejected'; response: RejectedConnectionResponse }
  | { status: 'error'; error: Event }
```

| Variant | Reason / Detail | When Occurs |
|---|---|---|
| `connecting` | N/A | Initial stream handshake or backoff delay before retry. |
| `open` | N/A | Connection is live and listening for events. |
| `closed` | `manual` | Caller explicitly invoked `close()`. |
| `closed` | `unmount` | React component unmounted. |
| `closed` | `revoked` | Server issued a terminal `revoke` frame. Auto-reconnect is disabled. |
| `closed` | `rejected` | HTTP handshake returned a non-retryable HTTP status. |
| `error` | `error: Event` | Stream error occurred and retries were exhausted or disabled. |

---

## 8. `withCredentials`

Set `withCredentials: true` to send HTTP cookies and authentication headers on cross-origin SSE connections. See [Security Guide](./security.md) for full cookie authentication patterns.

---

## 9. Target Auto-Inference

Adapter hooks (`useTanstackQueryAdapter`, `useSwrAdapter`, `useRtkQueryAdapter`) attach a phantom brand (`__restaleTarget`) to the callback. `useReStale` automatically reads this brand to set `target` and append `__restale_target__` to the SSE URL. You do not need to specify `target` manually unless overriding it.
