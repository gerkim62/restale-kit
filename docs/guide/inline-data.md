# Inline Data Resolution

Inline data delivery allows server mutations to push updated query data directly into client caches over the existing SSE stream, bypassing secondary fetch requests.

---

## 1. The Resolver Contract

Because different connected users may have different permissions or view states, inline data payloads must be resolved per connection. You provide an `inlineDataResolver` to `SSEChannelGroup`.

The resolver receives:
1. `connections`: List of matched active connections with their `connectionId`, `meta`, and `clientContext`.
2. `payload`: The mutation payload passed to `group.local.pushInlineData(payload, filter)`.

It returns a Map specifying the action for each connection:
- `{ action: 'inlineData', signal: { key }, inlineData, markStale? }`: Directly update cache.
- `{ action: 'revalidate', signal: { key } }`: Fall back to standard query refetch.
- `{ action: 'skip' }`: Do not notify this connection.

<!-- snippet:start inline-data-resolver -->
```ts
import { SSEChannelGroup, type InlineDataResolver } from 'restale-kit/server'

interface UserMeta {
  userId: string
  role: string
}

interface ClientContext {
  activeWorkspaceId: string
}

const customResolver: InlineDataResolver<UserMeta, ClientContext> = (connections, payload) => {
  const map = new Map()
  const todo = payload as { id: string; workspaceId: string; title: string }

  for (const conn of connections) {
    // Only send inline data to clients actively viewing this workspace
    if (conn.clientContext?.activeWorkspaceId === todo.workspaceId) {
      map.set(conn.connectionId, {
        action: 'inlineData',
        signal: { key: ['todos', { id: todo.id }] },
        inlineData: todo,
        markStale: false,
      })
    } else {
      // Other connections fall back to a revalidate signal
      map.set(conn.connectionId, {
        action: 'revalidate',
        signal: { key: ['todos'] },
      })
    }
  }

  return map
}

const group = new SSEChannelGroup<UserMeta, ClientContext>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
  inlineDataResolver: customResolver,
})

export async function pushTodoUpdate(todo: { id: string; workspaceId: string; title: string }) {
  await group.local.pushInlineData(todo, () => true)
}
```
<!-- snippet:end -->

---

## Doctest

```ts doctest:inline_data_verification
import { SSEChannelGroup } from 'restale-kit/server'

const group = new SSEChannelGroup({
  secret: 'inline-test-secret-32-chars-min',
  inlineDataResolver: (conns, payload) => new Map(),
})

expect(typeof group.local.pushInlineData).toBe('function')
```
