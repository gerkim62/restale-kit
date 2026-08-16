# Client Context and Inline Data Push

Most ReStale signals invalidate a cache entry and let the client refetch it. Inline data push is for the cases where the server has already computed the next value and can write it into each connected client's cache immediately.

The server resolves data separately for every connection, using two distinct inputs:

| Value | Set by | Purpose | Trust level |
|---|---|---|---|
| `meta` | Server, when the SSE connection opens | Authorization and identity | Authoritative |
| `clientContext` | Client, after the SSE connection opens | Query shape such as page, sort, and filters | Untrusted |
| `payload` | Application code calling `pushInlineData` | Describes the mutation that triggered the push | JSON-safe application data |

`clientContext` must never decide what a connection is authorized to see. Authorize from `meta` or the authenticated mutation request, then use `clientContext` only to select a slice of that already-authorized data.

---

## End-to-end setup

This example sends each user the current page of their own todos without requiring a refetch.

```ts
import express from 'express'
import { z } from 'zod'
import { isJSONValue, SchemaValidationError } from 'restale-kit'
import { SSEChannelGroup } from 'restale-kit/server'

type Meta = { userId: string }
type ClientContext = {
  page: number
  pageSize: number
  sortBy: 'createdAt' | 'title'
}

const clientContextSchema = z.object({
  page: z.number().int().min(0),
  pageSize: z.number().int().min(1).max(100),
  sortBy: z.enum(['createdAt', 'title']),
})

const group = new SSEChannelGroup<Meta, ClientContext>({
  clientContextSchema,
  resolveInlineData: async (connections, payload) => {
    const change = payload as { teamId: string }
    const userIds = [...new Set(connections.map((connection) => connection.meta?.userId).filter(Boolean))]
    const todos = await db.todos.findMany({
      where: { teamId: change.teamId, userId: { in: userIds } },
    })

    return new Map(connections.map((connection) => {
      const context = connection.clientContext
      const page = context?.page ?? 0
      const pageSize = context?.pageSize ?? 20
      const userTodos = todos
        .filter((todo) => todo.userId === connection.meta?.userId)
        .sort((a, b) => context?.sortBy === 'title'
          ? a.title.localeCompare(b.title)
          : b.createdAt.localeCompare(a.createdAt))

      return [connection.connectionId, {
        signal: {
          key: ['todos', { page, pageSize, userId: connection.meta?.userId }],
        },
        inlineData: userTodos.slice(page * pageSize, (page + 1) * pageSize),
        markStale: false,
      }]
    }))
  },
  onInlineDataResolverError: ({ topic, missingConnectionIds }) => {
    logger.error({ topic, missingConnectionIds }, 'inline-data resolver omitted connections')
  },
})
```

The resolver receives all local connections for a topic in one call. Batch database work there, then return one entry for every supplied `connectionId`. Every entry supplies its complete signal, including the exact cache key to update.

```ts
app.get('/sse', (req, res) => {
  group.attachNodeResponse(req, res, {
    meta: { userId: req.user.id },
    topics: [`team:${req.user.teamId}`],
  })
})

app.post('/sse', async (req, res) => {
  const { purpose, connectionId, clientContext, revision } = req.body ?? {}
  if (purpose !== 'CLIENT_CONTEXT') {
    res.status(400).end()
    return
  }
  if (
    typeof connectionId !== 'string' || connectionId.trim() === '' ||
    !isJSONValue(clientContext) ||
    (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0))
  ) {
    res.status(400).end()
    return
  }

  try {
    const result = await group.updateClientContext(connectionId, clientContext, {
      scope: { userId: req.user.id },
      revision,
    })
    res.status(result.updated ? 204 : 404).end()
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      res.status(400).end()
      return
    }
    throw error
  }
})

app.post('/api/todos', async (req, res) => {
  const todo = await db.todos.create({ data: req.body })
  await group.pushInlineData(`team:${todo.teamId}`, { teamId: todo.teamId })
  res.status(201).json(todo)
})
```

The route needs normal JSON body parsing, for example `app.use(express.json())` in Express.

### Context registration responses

| Status | Meaning |
|---|---|
| `204` | Context was stored. |
| `404` | The caller's instance did not update a matching local connection. This can happen if the client posts before the stream has registered; with pub/sub, another instance may still own and apply the update. |
| `400` | The request body is malformed, `purpose` is not `CLIENT_CONTEXT`, or `clientContextSchema` rejected the value. |

Always scope-pin `updateClientContext` using trusted server-side identity. A connection ID is an opaque correlation value, not an authentication credential.

---

## Resolver contract

`resolveInlineData` is called once per topic per instance, not once per connection:

```ts
type InlineDataConnection<TMeta, TClientContext> = {
  readonly connectionId: string
  readonly meta: TMeta | undefined
  readonly clientContext: TClientContext | undefined
}

type InlineDataResult = {
  signal: RevalidateSignal
  inlineData?: JSONValue
  markStale?: boolean
}

type ResolveInlineData<TMeta, TClientContext> = (
  connections: ReadonlyArray<InlineDataConnection<TMeta, TClientContext>>,
  payload: JSONValue,
) => Map<string, InlineDataResult> | Promise<Map<string, InlineDataResult>>
```

- Return an entry for every supplied connection. `clientContext` may be `undefined`; handle that case deliberately.
- Include `inlineData` to write data into that connection's cache. Omit it to send a normal invalidation for that connection.
- Set `markStale: true` on the result if you want the client to mark the entry stale after writing inline data.
- A missing map entry does not prevent delivery to valid entries. ReStale calls `onInlineDataResolverError` with the omitted connection IDs.
- If the resolver throws, no local connection receives data for that invocation and `pushInlineData` rejects.
- `pushInlineData(topic, payload)` validates both arguments, requires a configured resolver, delivers locally first, then publishes to other instances when a pub/sub adapter is configured.

`payload` is the only resolver input that crosses pub/sub. `meta` and `clientContext` remain on the instance that owns the SSE connection.

---

## Client context registration

With React, pass `clientContext` to `useReStale`. It is canonically serialized with key sorting, sent whenever it changes while the stream is open, and resent after every successful open.

```tsx
const onInvalidate = useSwrAdapter(mutate)

useReStale('/sse', {
  onInvalidate,
  clientContext: { page, pageSize: 20, sortBy },
  clientContextSync: {
    maxAttempts: 2,
    retryDelayMs: 200,
    onExhausted: 'retryOnNextChange',
  },
})
```

`clientContextUrl` optionally points at a separate POST endpoint; otherwise it uses the SSE URL. The default retry policy makes two attempts per sync, retrying a `404` or network error after 200 ms. 

When context synchronization fails after all retry attempts are exhausted:
- `useReStale` logs an error via `console.error('[restale-kit][useReStale] Failed to synchronize clientContext.')`.
- It triggers a background query invalidation/refetch via `onInvalidate` so the client does not remain stuck on stale data.
- With `onExhausted: 'disableUntilReconnect'`, context sync pauses after failures until the stream opens again. The SSE invalidation callback continues to work regardless of context sync failures.

For non-React clients, decide retry policy yourself:

```ts
const client = new SSEInvalidatorClient('/sse', { clientContextUrl: '/sse' })
await client.connect()

const { updated } = await client.updateClientContext({ page: 2, pageSize: 20, sortBy: 'createdAt' })
if (!updated) {
  // The connection was not registered yet or is no longer present.
}
```

The method returns `{ updated: true }` for `204`, `{ updated: false }` for `404`, and throws for network failures and other response statuses.

---

## Slow clients, race conditions, and stale client context

In real-world web applications, network latency and concurrency can create race conditions between client context updates and server mutations:

```text
Client (User changes page 1 -> 2)            Server (Mutation occurs)
─────────────────────────────────            ────────────────────────
1. Client updates local state to page 2.
2. Client sends POST /sse (page 2 context).
                                             3. Server receives a mutation and calls pushInlineData().
                                             4. Server resolves data using OLD context (page 1) because
                                                POST (step 2) is still in transit across the network.
5. Client receives SSE signal for page 1.    5. Server transmits SSE signal with page 1 inlineData.
6. Client discards page 1 inlineData,
   refetches page 2, and resyncs context!
7. POST /sse arrives at server; server updates connection context to page 2.
```

### How ReStale prevents cache corruption

1. **Deterministic Canonical Hashing**:
   - Whenever `pushInlineData` resolves data on the server, ReStale computes a whitespace-independent, key-sorted hash (`contextHash`) of the connection's `clientContext` (using `canonicalJsonSerialize` and `computeContextHash`).
   - Object key ordering differences (e.g. `{ page: 1, sort: 'asc' }` vs `{ sort: 'asc', page: 1 }`) produce identical hashes.
   - The computed `contextHash` is attached to the outgoing SSE signal.

2. **Client-Side Verification**:
   - When `useReStale` receives an incoming signal containing `inlineData` and a `contextHash`, it compares `signal.contextHash` against the canonical hash of the current active `clientContext`.
   - **Matching Hash**: The pushed `inlineData` is guaranteed to match the exact view/parameters currently active on the client. It is written directly into the cache.
   - **Mismatched Hash (Stale Push)**: The user navigated, filtered, or paged away before the pushed data arrived. `useReStale` automatically:
     - **Discards `inlineData`**: Strips `inlineData` from the signal so stale data is never written into the query cache.
     - **Triggers Immediate Refetch**: Forwards the stripped signal to `onInvalidate`, turning it into a regular invalidation/refetch for the active query.
     - **Re-triggers Context Sync**: Initiates an immediate synchronization to ensure the server receives the client's latest context.

This ensures zero cache corruption and seamless self-healing even over high-latency or fluctuating connections.

---

## Cache adapter behavior

`inlineData` is carried by `InlineDataSignal`. SWR and TanStack Query write to the resolver-provided key exactly:

| Adapter | Write | Stale marking when `markStale: true` |
|---|---|---|
| SWR | `mutate(key, inlineData, { revalidate: false })` | Bare `mutate(key)` marks the same exact key stale |
| TanStack Query | `setQueryData(queryKey, inlineData)` | `invalidateQueries({ queryKey, exact: true })` |

Inline-data writes never use prefix or hierarchical matching, so a connection-specific page cannot overwrite sibling cache entries.

---

## Multi-instance deployments

Configure the same resolver on every instance. ReStale publishes `{ kind: 'inlineData', topic, payload }` on the control topic. Each instance with local connections for the topic independently calls its resolver using only its own `meta` and `clientContext`.

Use the existing Redis, Ably, or Pusher adapters as normal. Custom adapters must preserve the `inlineData` member of `PubSubMessage` and retain their existing self-echo suppression behavior.

See the [Server guide](./server.md), [Client guide](./client.md), and [Pub/Sub guide](./pubsub.md) for the surrounding transport setup.
