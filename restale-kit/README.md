# ReStale Kit

ReStale Kit delivers cache invalidation over Server-Sent Events using one library-neutral wire protocol. The server emits a `UniversalSignal`; client adapters translate it for TanStack Query, SWR, or an application-owned cache.

```ts
import { SSEChannelGroup } from 'restale-kit/server'

const group = new SSEChannelGroup()

group.broadcastToAll({ key: ['todos'] })
group.broadcastToAll({
  key: ['todos', 1],
  inlineData: { id: 1, title: 'Updated' },
  markStale: true,
})
```

## Wire protocol

```ts
type CacheKey = JSONValue[]

type RevalidateSignal = {
  key: CacheKey
  exact?: boolean
}

type InlineDataSignal = {
  key: CacheKey
  inlineData: JSONValue
  markStale?: boolean
}
```

`exact: true` requests an exact revalidation. Omitted or `false` requests prefix/hierarchical revalidation. Inline-data writes are always exact; `markStale` defaults to `false`.

There is no target field, target query parameter, response target header, server-side cache-library configuration, or RTK Query adapter.

## Client adapters

```ts
import { useReStale } from 'restale-kit/react'
import { useTanstackQueryAdapter } from 'restale-kit/tanstack-query'

const onInvalidate = useTanstackQueryAdapter(queryClient, {
  toQueryKey: (key) => ['api', ...key],
})

useReStale('/api/sse', { onInvalidate })
```

For SWR, use `swrAdapter` or `useSwrAdapter`. Its optional `toKey` maps a universal array key to a native SWR key, including a string key.

## SSE connection

Only `__restale_cid__` is added to the EventSource URL. It identifies a connection for replay, client context, and revocation. `Last-Event-ID` replay, keepalives, renew frames, and revocation remain supported.
