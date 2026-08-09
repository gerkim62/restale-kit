# Spec: Targeted Contextual Data Push (`group.broadcast` Overload)

**Package:** `restale-kit`  
**Area:** `server/core/channel-group.ts`, `pubsub/core`, `types/protocol.ts`  
**Status:** Proposed  

---

## 1. Executive Summary & "Why"

### The Problem
When backend data changes (e.g., a new product is added or a price updates), broadcasting a plain invalidation signal forces every connected client to re-fetch data from the backend at the same time. This creates a **thundering herd** problem on database and API servers.

Furthermore, different clients are viewing different "windows" of data (e.g., User A is on Page 1 sorted by Price, User B is on Page 5 sorted by Rating). Sending blanket data updates to all clients wastes bandwidth for data they aren't looking at.

### The Solution
`restale-kit` stores `clientContext` (e.g., `{ page: 1, sort: 'price' }`) per connection. 

This spec introduces an overloaded variant of `SSEChannelGroup.prototype.broadcast()` that accepts an **async signal generator** and a **contextual predicate**. It allows backend mutations to push pre-computed, windowed `optimisticData` payloads directly into each client's query cache on matching active local connections—evaluating `where(meta, context)` and `signal(meta, context)` locally without requiring manual filtering.

---

## 2. Public API Surface

### `SSEChannelGroup.prototype.broadcast` Overload

An additional overload signature is added to `SSEChannelGroup`:

```ts
export interface BroadcastContextualOptions<
  TSignal extends InvalidateSignal = InvalidateSignal,
  TMeta = unknown,
  TClientContext = unknown,
> {
  /**
   * Optional predicate function to filter which connections should receive the update.
   * Receives both the authoritative connection `meta` and the client-supplied `clientContext`.
   * Default: () => true (evaluates all active connections).
   */
  where?: (meta: TMeta | undefined, context: TClientContext | undefined) => boolean

  /**
   * Async signal generator executed per matching connection.
   * Receives the connection's `meta` and `clientContext`.
   * Return a signal (or array of signals) containing `optimisticData`.
   * Return `null` or `undefined` to skip delivery for a specific connection.
   */
  signal: (
    meta: TMeta | undefined,
    context: TClientContext | undefined
  ) => Promise<TSignal | TSignal[] | null | undefined> | TSignal | TSignal[] | null | undefined
}
```

#### Method Overload Signature on `SSEChannelGroup`:

```ts
export class SSEChannelGroup<...> {
  // Existing overloads:
  broadcast(signal: TSignal | TSignal[], predicate?: (meta: TMeta | undefined) => boolean): void

  // NEW Overload: Targeted Contextual Data Push
  broadcast(options: BroadcastContextualOptions<TSignal, TMeta, TClientContext>): Promise<void>
}
```

---

## 3. Usage Examples

### Server Setup & Usage

```ts
import { SSEChannelGroup } from 'restale-kit/server'
import { redisPubSub } from 'restale-kit/pubsub/redis'
import type { TanStackQuerySignal } from 'restale-kit'
import { db } from './db'

interface UserMeta {
  userId: string
  role: 'user' | 'admin'
}

interface ProductViewContext {
  page: number
  sort: 'price' | 'rating' | 'newest'
  category?: string
}

// 1. Initialize SSEChannelGroup with PubSub (configured once)
export const productGroup = new SSEChannelGroup<
  TanStackQuerySignal,
  UserMeta,
  'tanstack-query',
  ProductViewContext
>({
  target: 'tanstack-query',
  pubsub: redisPubSub({ url: process.env.REDIS_URL }),
})

// 2. In your backend API route (e.g. POST /api/products mutation):
export async function createProductHandler(req, res) {
  const newProduct = await db.products.create(req.body)

  // ⚡️ Targeted Contextual Data Push — zero Redis code required!
  await productGroup.broadcast({
    // Only target connections viewing the product list
    where: (meta, context) => context?.page !== undefined,

    // Async generator computes the windowed optimisticData slice per client
    signal: async (meta, context) => {
      // If user is past page 3, don't push data (let them fetch on demand)
      if (!context || context.page > 3) return null

      const windowedSlice = await db.products.findMany({
        where: { category: context.category },
        orderBy: { [context.sort]: 'asc' },
        skip: (context.page - 1) * 20,
        take: 20,
      })

      return {
        queryKey: ['products', { page: context.page, sort: context.sort }],
        optimisticData: windowedSlice,
      }
    },
  })

  return res.json({ success: true })
}
```

### Client React Setup (`useReStale`)

```tsx
import { useReStale } from 'restale-kit/react'
import { useTanstackQueryAdapter } from 'restale-kit/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'

export function ProductList({ page, sort }: { page: number; sort: string }) {
  const queryClient = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(queryClient)

  // 🚀 Zero useEffect! useReStale automatically syncs clientContext on mount,
  // whenever page/sort change, or upon reconnecting.
  const { isConnected, updateClientContext } = useReStale('/api/sse', {
    onInvalidate,
    clientContext: { page, sort },
  })

  return <div>{/* Render Product List */}</div>
}
```

### Framework-Agnostic & Non-React Setup (`SSEInvalidatorClient`)

For Vanilla JS, Vue, Svelte, SolidJS, or Angular, `SSEInvalidatorClient` provides first-class support for `clientContext`:

#### Vanilla JS
```ts
import { SSEInvalidatorClient } from 'restale-kit/client'

// Pass initial clientContext in ClientOptions
const client = new SSEInvalidatorClient('/api/sse', {
  clientContext: { page: 1, sort: 'price' }
})

// Update context imperatively anytime state changes:
await client.updateClientContext({ page: 2, sort: 'price' })
```

#### Vue 3 (Composition API)
```vue
<script setup>
import { ref, watchEffect } from 'vue'
import { SSEInvalidatorClient } from 'restale-kit/client'

const page = ref(1)
const sort = ref('price')

const client = new SSEInvalidatorClient('/api/sse', {
  clientContext: { page: page.value, sort: sort.value }
})

// Automatically sync when Vue reactive refs change
watchEffect(() => {
  client.updateClientContext({ page: page.value, sort: sort.value })
})
</script>
```

#### Svelte 5 (`$effect`)
```svelte
<script>
  import { SSEInvalidatorClient } from 'restale-kit/client'
  
  let page = $state(1)
  let sort = $state('price')

  const client = new SSEInvalidatorClient('/api/sse', {
    clientContext: { page, sort }
  })

  $effect(() => {
    client.updateClientContext({ page, sort })
  })
</script>
```

---

## 4. Multi-Server Cluster Architecture (`broadcastContextual`)

In multi-server production deployments (e.g. 4 Node.js instances behind a load balancer with Redis):

```
                       ┌────────────────────────┐
                       │  Mutation (Node 1)     │
                       └───────────┬────────────┘
                                   │
                                   ▼
                   [group.broadcastContextual(payload)]
                                   │
         (Publishes `contextualBroadcast` control frame over `controlTopic`)
                                   │
                                   ▼
                       ┌────────────────────────┐
                       │ Redis / PubSub Channel │
                       └───────────┬────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
 ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
 │   Server Node 1   │   │   Server Node 2   │   │   Server Node 3   │
 └─────────┬─────────┘   └─────────┬─────────┘   └─────────┬─────────┘
           │                       │                       │
 (Evaluates local        (Evaluates local        (Evaluates local
  connections &           connections &           connections &
  executes generator)     executes generator)     executes generator)
           │                       │                       │
           ▼                       ▼                       ▼
  Local SSE Streams       Local SSE Streams       Local SSE Streams
```

1. **Node 1** invokes `group.broadcastContextual(payload)` (or `group.broadcastContextual(handlerName, payload)`).
2. **Node 1** evaluates its active local connections against its registered contextual generator function (`contextualSignal` / `contextualWhere`).
3. **Node 1** publishes a `contextualBroadcast` control message (`{ kind: 'control', data: { type: 'contextualBroadcast', senderInstanceId, handlerName, payload } }`) over `controlTopic`.
4. **Every server node** (Node 2, Node 3) receives the control message via PubSub. Remote nodes filter out self-echo based on `senderInstanceId`.
5. **Node 2 and Node 3** each execute their registered contextual generator function (`contextualSignal(payload, meta, context)`) against their own local active SSE connections.
6. The resolved `optimisticData` payloads are delivered down each server node's local SSE streams directly into the respective client query caches.

---

## 5. Security & Authorization Constraints

> [!IMPORTANT]
> **Client Context is Untrusted Input**
> `clientContext` is supplied by the client and must never be used as the sole basis for data authorization. 

- `where(meta, context)` and `signal(meta, context)` always receive `meta` (authoritative, server-minted identity, e.g. `userId`, `tenantId`, `role`) alongside `clientContext`.
- Developers must verify that `meta` authorizes access before querying or returning sensitive `optimisticData` payloads in the `signal` generator.

---

## 6. Design Non-Goals & Explicit Omissions

1. **No Automatic Framework Memoization**: `restale-kit` will **not** attempt to memoize `signal(meta, context)` calls across connections automatically. Because `meta` carries authoritative user authorization state (`userId`, `role`), memoizing solely on `clientContext` could introduce security vulnerabilities (e.g., leaking privileged data across different user identities). Application-level batching/caching (such as `DataLoader` or Redis LRU) remains the responsibility of application code.

2. **No Silent Timeout Transformations**: `restale-kit` will **not** silently convert timed-out or failing `signal(meta, context)` executions into plain invalidation signals behind the developer's back. DB timeouts must be managed at the application layer (via `AbortController` or DB query timeouts). If `signal()` rejects or throws, standard exception logging and error reporting apply.

3. **No Direct Serialization of Inline Function Closures**: JavaScript function closures (`signal` / `where` functions defined inline in an API route) cannot be serialized into JSON across PubSub channels. To achieve cluster-wide contextual broadcasts across multi-node setups, applications configure `contextualSignal` on `SSEChannelGroupOptions` or register named handlers via `group.registerContextualHandler(name, handler)` so every server instance can independently execute its local generator when a `broadcastContextual(payload)` control message arrives over PubSub.

---
