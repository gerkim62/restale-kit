# Core Concepts

ReStale Kit revolves around a minimal, resilient protocol for cache synchronization over Server-Sent Events (SSE).

---

## 1. Channels & Groups

### `SSEChannel`
Represents an individual persistent HTTP stream to a connected client. Created and managed automatically by `SSEChannelGroup.handle()`. Each channel has:
- A cryptographic HMAC-signed `connectionId`.
- Server-side metadata (`TMeta`) associated at connection time.
- Automatic keepalive heartbeats and disconnect cleanup.

### `SSEChannelGroup`
The primary server-side coordinator. It manages active connections, topic subscriptions, HMAC signing, client context tracking, and invalidation routing.

---

## 2. Invalidation Signals vs. Inline Data

ReStale Kit supports two distinct data delivery modes:

### Revalidation Signals (`RevalidateSignal`)
Lightweight invalidation events carrying hierarchical cache keys:
```ts
{ key: ['todos', { userId: '123' }] }
```
When received by the browser, the client adapter (`tanstackQueryAdapter` or `swrAdapter`) marks matching queries stale and immediately refetches active queries.

### Inline Data Signals (`InlineDataSignal`)
Direct payload delivery bypassing the refetch roundtrip:
```ts
{
  key: ['todos', { id: 'todo_1' }],
  inlineData: { id: 'todo_1', text: 'Updated title' },
  markStale: false
}
```
Directly writes new data into the client query cache.

---

## 3. Local vs. Cluster Semantics

ReStale Kit cleanly separates single-instance and distributed operations:

| Operation | In-Memory (`group.local.*`) | Distributed Cluster (`group.cluster.*`) |
|---|---|---|
| Invalidation | `group.local.broadcast(signal, filter)` | `group.cluster.broadcast(topic, signal)` |
| Inline Data | `group.local.pushInlineData(payload, filter)` | `group.cluster.pushInlineData(topic, payload)` |
| Revocation | `group.local.revokeWhere(filter)` | `group.cluster.revokeWhere(filter)` |
| Token Revocation | `group.local.revokeByConnectionId(id, scope?)` | `group.cluster.revokeByConnectionId(id, scope?)` |

---

## Doctest

```ts doctest:concepts_verification
import { SSEChannelGroup } from 'restale-kit/server'

const group = new SSEChannelGroup({
  secret: 'concept-test-secret-at-least-32-chars',
})

const res = group.local.broadcast({ key: ['posts'] }, () => true)
expect(res.sent).toBe(0)
expect(res.errors).toBe(0)
```
