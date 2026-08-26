# Client Core API Reference (`restale-kit/client`)

> **Entrypoint:** `restale-kit/client`

---

## Exported Symbols

| Symbol | Kind | Class Members / Sub-namespaces |
|---|---|---|
| `SSEClient` | `symbol` | `prototype` |
| `AutoReconnectOptions` | `symbol` | — |
| `ConnectionStatus` | `symbol` | — |
| `ClientOptions` | `symbol` | — |
| `ReconnectOptions` | `symbol` | — |
| `HttpStatusMatcher` | `symbol` | — |
| `RejectedConnectionResponse` | `symbol` | — |
| `SSEClientEventMap` | `symbol` | — |
| `InvalidationHandler` | `symbol` | — |
| `RevokeEventDetail` | `symbol` | — |
| `RenewEventDetail` | `symbol` | — |
| `Signal` | `symbol` | — |
| `SignalPayload` | `symbol` | — |
| `RevalidateSignal` | `symbol` | — |
| `InlineDataSignal` | `symbol` | — |
| `CacheKey` | `symbol` | — |

---

## Detailed Symbol Documentation

### `SSEClient` (`symbol`)

Browser client managing SSE stream, exponential backoff reconnects, and invalidation event routing.

- `new SSEClient(url, options?)`
- `client.connect()`
- `client.close()`
- `client.addEventListener('invalidate', handler)`
- `client.addEventListener('statuschange', handler)`

### `AutoReconnectOptions` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `ConnectionStatus` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `ClientOptions` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `ReconnectOptions` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `HttpStatusMatcher` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `RejectedConnectionResponse` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `SSEClientEventMap` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `InvalidationHandler` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `RevokeEventDetail` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `RenewEventDetail` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `Signal` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `SignalPayload` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `RevalidateSignal` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `InlineDataSignal` (`symbol`)

Public exported symbol from `restale-kit/client`.

### `CacheKey` (`symbol`)

Public exported symbol from `restale-kit/client`.

