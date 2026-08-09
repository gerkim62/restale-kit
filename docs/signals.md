# Signals & Key Matching

`InvalidateSignal` is a discriminated union describing invalidation messages sent over SSE.

---

## 1. Signal Shapes

### `TanStackQuerySignal` (`target: 'tanstack-query'`)

```ts
interface TanStackQuerySignal {
  target?: 'tanstack-query'
  queryKey: JSONValue[]
  exact?: boolean
  type?: 'active' | 'inactive' | 'all'
  action?: 'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel'
  stale?: boolean
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `target` | `'tanstack-query'` | Optional | Discriminator identifier for TanStack Query. |
| `queryKey` | `JSONValue[]` | **Required** | The hierarchical query key array to target. |
| `exact` | `boolean` | `false` | When `true`, matches only queries with the exact key length and structure. |
| `type` | `'active' \| 'inactive' \| 'all'` | `'all'` | Targets specific query observation states. |
| `action` | `'invalidate' \| 'refetch' \| 'reset' \| 'remove' \| 'cancel'` | `'invalidate'` | The query client action to execute. |
| `stale` | `boolean` | `undefined` | Controls refetch behavior on invalidation (`stale: true` marks stale without active refetch). |

```json
{
  "target": "tanstack-query",
  "queryKey": ["users", 42, "posts"],
  "exact": true,
  "action": "invalidate"
}
```

---

### `SWRSignal` (`target: 'swr'`)

```ts
interface SWRSignal {
  target?: 'swr'
  key: string | JSONValue[]
  action?: 'revalidate' | 'purge' | 'remove' | 'mutate'
  revalidate?: boolean
  match?: 'exact' | 'prefix'
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `target` | `'swr'` | Optional | Discriminator identifier for SWR. |
| `key` | `string \| JSONValue[]` | **Required** | The string or tuple key to match against the SWR cache. |
| `action` | `'revalidate' \| 'purge' \| 'remove' \| 'mutate'` | `'revalidate'` | Cache mutation action. `'purge'` and `'remove'` trigger eviction without revalidation. |
| `revalidate` | `boolean` | `true` | When `false`, suppresses immediate network revalidation. |
| `match` | `'exact' \| 'prefix'` | `'prefix'` | String or tuple prefix matching behavior. |

```json
{
  "target": "swr",
  "key": "/api/users/42",
  "match": "exact",
  "action": "revalidate"
}
```

---

### `RTKQuerySignal` (`target: 'rtk-query'`)

```ts
interface RTKQuerySignal {
  target?: 'rtk-query'
  tags: Array<string | { type: string; id?: string | number }>
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `target` | `'rtk-query'` | Optional | Discriminator identifier for RTK Query. |
| `tags` | `Array<string \| { type: string; id?: string \| number }>` | **Required** | List of RTK Query cache tag definitions to invalidate. |

```json
{
  "target": "rtk-query",
  "tags": ["Posts", { "type": "User", "id": 42 }]
}
```

---

### `GenericInvalidateSignal` (`target: 'generic'` or omitted)

```ts
interface GenericInvalidateSignal {
  target?: 'generic'
  key: JSONValue[]
  exact?: boolean
  action?: 'invalidate' | 'refetch' | 'remove'
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `target` | `'generic'` | Optional | Discriminator identifier for generic client stores. |
| `key` | `JSONValue[]` | **Required** | Array key representation. |
| `exact` | `boolean` | `false` | Exact key matching requirement. |
| `action` | `'invalidate' \| 'refetch' \| 'remove'` | `'invalidate'` | Intended cache operation. |

```json
{
  "target": "generic",
  "key": ["settings"],
  "action": "invalidate"
}
```

---

## 2. Key Matching Semantics

Key matching logic in `matchesInvalidateSignalKey` handles hierarchical tuple arrays, string keys, and object properties:

| Cache Key | Signal Key | Mode | Match? | Reason |
|---|---|---|---|---|
| `['users', 42]` | `['users']` | Prefix (`exact: false`) | **Match** | Signal key is a prefix of the cache key |
| `['users', 42]` | `['users']` | Exact (`exact: true`) | **No** | Array lengths differ (2 vs 1) |
| `['users', 42, { draft: true }]` | `['users', 42, {}]` | Subset (`exact: false`) | **Match** | Empty object `{}` matches any object |
| `['users', 42, { draft: true }]` | `['users', 42, { draft: true }]` | Exact | **Match** | All properties and values match |
| `['users', 42, { draft: true }]` | `['users', 42, { draft: false }]` | Subset | **No** | Property value mismatch (`true` vs `false`) |
| `'/api/users/42'` | `'/api/users'` | SWR Prefix (`match: 'prefix'`) | **Match** | String starts with prefix |

---

## 3. Signal Batching

Server broadcasting methods and client listeners support emitting arrays of signals in a single SSE event frame (`TSignal | TSignal[]`):

```ts
// Server broadcasting a batch of signals
group.broadcastToAll([
  { queryKey: ['users'] },
  { queryKey: ['stats'] },
])
```

Client adapters automatically unpack and process array batches sequentially.

---

## 4. `SIGNAL_TARGETS` Constants

The package exports `SIGNAL_TARGETS` from `restale-kit` and `restale-kit/server`:

```ts
export const SIGNAL_TARGETS = {
  TANSTACK_QUERY: 'tanstack-query',
  SWR: 'swr',
  RTK: 'rtk-query',
  GENERIC: 'generic',
} as const
```
