# Server API Reference (`restale-kit/server`)

> **Entrypoint:** `restale-kit/server`

---

## Exported Symbols

| Symbol | Kind | Class Members / Sub-namespaces |
|---|---|---|
| `createSSEChannel` | `symbol` | — |
| `SSEChannel` | `symbol` | — |
| `SSEChannelOptions` | `symbol` | — |
| `SSEChannelGroup` | `symbol` | `prototype` |
| `SSEChannelGroupOptions` | `symbol` | — |
| `ChannelSetupOptions` | `symbol` | — |
| `InlineDataConnection` | `symbol` | — |
| `InlineDataResolverResult` | `symbol` | — |
| `InlineDataResolver` | `symbol` | — |
| `FastifyRequestLike` | `symbol` | — |
| `FastifyReplyLike` | `symbol` | — |
| `NodeRequestLike` | `symbol` | — |
| `NodeResponseLike` | `symbol` | — |
| `createEventStore` | `symbol` | — |
| `EventStoreOptions` | `symbol` | — |
| `EventStore` | `symbol` | — |
| `EventRecord` | `symbol` | — |
| `EventStoreResult` | `symbol` | — |
| `ChannelDefaults` | `symbol` | — |
| `LocalFilter` | `symbol` | — |
| `ClusterFilter` | `symbol` | — |

---

## Detailed Symbol Documentation

### `createSSEChannel` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `SSEChannel` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `SSEChannelOptions` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `SSEChannelGroup` (`symbol`)

Universal SSE group manager and router.

#### Key Properties & Methods

- `group.handle(req, res, options?)` — Universal HTTP handler for Express, Fastify, and Node.js
- `group.handle(request, options?)` — Universal Fetch API handler for Next.js Route Handlers, Hono, Bun, and Deno
- `group.local.broadcast(signal, filter)` — In-memory signal broadcasting
- `group.local.revokeWhere(filter)` — In-memory connection revocation
- `group.local.revokeByConnectionId(connectionId, scope?)` — In-memory token revocation
- `group.local.pushInlineData(payload, filter)` — In-memory inline data delivery
- `group.cluster.broadcast(topic, signal)` — Distributed pub/sub broadcasting
- `group.cluster.pushInlineData(topic, payload)` — Distributed inline data delivery
- `group.cluster.revokeWhere(filter)` — Distributed connection revocation
- `group.cluster.revokeByConnectionId(connectionId, scope?)` — Distributed token revocation

### `SSEChannelGroupOptions` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `ChannelSetupOptions` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `InlineDataConnection` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `InlineDataResolverResult` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `InlineDataResolver` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `FastifyRequestLike` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `FastifyReplyLike` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `NodeRequestLike` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `NodeResponseLike` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `createEventStore` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `EventStoreOptions` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `EventStore` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `EventRecord` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `EventStoreResult` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `ChannelDefaults` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `LocalFilter` (`symbol`)

Public exported symbol from `restale-kit/server`.

### `ClusterFilter` (`symbol`)

Public exported symbol from `restale-kit/server`.

