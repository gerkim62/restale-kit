# Spec: Client Context and Per-Connection Data Push

**Package:** restale-kit
**Area:** `types/protocol.ts`, `server/core/channel-group.ts`, `client/core/sse-client.ts`, `client/react/useReStale.ts`, `client/swr/adapter.ts`, `client/tanstack-query/adapter.ts`
**Status:** Proposed
**Breaking changes:** Yes — accepted

## 1. Overview

Signals may carry a data payload in addition to a plain invalidation. The server computes this payload **per connection**, using that connection's authenticated identity (`meta`) and its currently registered client-supplied context (`clientContext`: pagination, sort, filters), then unicasts it so the client writes it straight into its cache without an intermediate refetch. This works identically in single-instance and multi-instance (pubsub-backed) deployments.

## 2. Terminology

| Term | Meaning |
|---|---|
| `meta` | Server-set, from the authenticated request, at connect time. Authoritative for identity. Determines **what a connection is allowed to see**. Immutable for the connection's lifetime. |
| `clientContext` | Client-set, via `POST /sse`, after connect. Untrusted. Shapes queries only — determines **which slice of already-authorized data to return** (page, sort, filter). Mutable via `updateClientContext`. |
| `payload` | Developer-supplied value passed to `pushInlineData`. Crosses the pubsub wire as-is. Shape is unrestricted (must be `JSONValue`). Given to the resolver alongside each connection's `meta`/`clientContext` to compute that connection's data. |

`meta` and `clientContext` must never be conflated. `clientContext` must never be used to determine authorization scope — see §15.

## 3. Protocol Changes

### 3.1 `PubSubMessage` — new `inlineData` kind

```ts
export type PubSubMessage<TSignal extends InvalidateSignal = InvalidateSignal> =
  | { kind: 'signal'; data: TSignal | TSignal[]; id?: string }
  | { kind: 'control'; data: JSONValue }
  | { kind: 'inlineData'; topic: string; payload: JSONValue }
```

`control` means "manage this connection" (revoke, close, update state). `inlineData` means "compute and deliver data inline to a client cache." These are different intents and get different kinds — any pubsub adapter that pattern-matches on `kind` gets a compile error if it doesn't handle the new case, which is correct.

### 3.2 `inlineData` field on signal types

```ts
export interface TanStackQuerySignal extends BaseInvalidateSignal {
  // ...existing fields
  inlineData?: JSONValue
}

export interface SWRSignal extends BaseInvalidateSignal {
  // ...existing fields
  inlineData?: JSONValue
}

export interface GenericInvalidateSignal extends BaseInvalidateSignal {
  // ...existing fields
  inlineData?: JSONValue
  // Generic is intentionally manual: the listener receives it raw and handles it
  // however it wants. No special adapter behavior beyond surfacing the field.
}

export interface RTKQuerySignal extends BaseInvalidateSignal {
  // No inlineData — RTK Query has no generic cache-write API to target.
}
```

## 4. `clientContext` Transport — `POST /sse`

Client context is submitted over `POST /sse`, the same path `GET /sse` uses for the stream, dispatched by HTTP method and discriminated by a `purpose` field in the body so future `POST /sse` operations can reuse this endpoint without new routes.

**Request body:**
```ts
{
  purpose: 'CLIENT_CONTEXT'
  connectionId: string
  clientContext: unknown  // validated against clientContextSchema if configured
  revision?: number       // monotonic client-context update revision
}
```

**Response:**
- `204` — context accepted and stored.
- `404` — the current instance did not update a matching local connection. The client may have posted before the stream registered; in PubSub deployments, a remote instance may still receive and apply the control message.
- `400` — malformed body, unrecognized `purpose`, **or `clientContextSchema` validation failure**.

**Server route:**
```ts
app.get('/sse', (req, res) => {
  group.attachNodeResponse(req, res, { meta: getMeta(req) })
})

app.post('/sse', async (req, res) => {
  const { purpose, connectionId, clientContext } = req.body

  if (purpose === 'CLIENT_CONTEXT') {
    try {
      const result = await group.updateClientContext(connectionId, clientContext, {
        scope: getScope(req) // scope-pinning against meta — same as revokeByConnectionId
      })
      res.status(result.updated ? 204 : 404).end()
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        res.status(400).end()
        return
      }
      throw err
    }
    return
  }

  res.status(400).end()
})
```

`updateClientContext` returns a promise that rejects with `SchemaValidationError` on a failing `clientContextSchema` check. Await it and map that rejection to `400`, as shown above; `register()`/`attachNodeResponse()` remain synchronous.

## 5. `updateClientContext` and `getClientContext`

```ts
async updateClientContext(
  connectionId: string,
  clientContext: TClientContext,
  options?: {
    scope?: Partial<Record<keyof TMeta, JSONValue | undefined>>
    revision?: number
  }
): Promise<{ updated: boolean }>

getClientContext(connectionId: string): TClientContext | undefined
```

(`scope`'s exact conditional type mirrors whatever `revokeByConnectionId` already declares for `TMeta extends object` vs. not — implement identically, don't reintroduce a looser type here.)

- Looks up the connection via the existing `connectionIndex` (`Map<connectionId, Set<channel>>`) — the same index `revokeByConnectionId` uses. **`connectionId` is 1:1 with a channel** (confirmed invariant, not just a type-level possibility) — a `connectionId` never resolves to more than one entry in practice, so "updates the entry for every channel registered under that `connectionId`" always means exactly one.
- **Scope-pinning is required, not optional.** If `options.scope` is provided, it is matched against the connection's stored `meta` before the update is applied (same matching `revokeByConnectionId` already uses). This is required because `connectionId` is unique but not secret: it's a client-generated value visible in URLs, logs, and referrers, and is not cryptographically bound to any session. Without scope-pinning, anyone who has observed a `connectionId` could overwrite that connection's `clientContext`.
- If `clientContextSchema` is configured, the incoming value is validated the same way `metaSchema` validates `meta`, using the same validation path. A failing validation rejects the update with the same error type `metaSchema` failures raise (`SchemaValidationError`), and does not partially apply.
- **Multi-instance:** if a `pubsub` adapter is configured, the update is additionally published on the existing `controlTopic`. Every instance is subscribed and checks `connectionIndex` locally; only the instance that owns the connection applies the update. This reuses the mechanism already in place for `revokeByConnectionId` — no new infrastructure. Pubsub self-echo is already suppressed at the envelope layer (`unwrapEnvelope`), so the originating instance does not re-process its own publish.
- Validation runs once, at the origin instance, before publish. **A receiving instance does not re-run `clientContextSchema`** against a value arriving via `controlTopic` — it trusts the value as already validated, mirroring how `revokeByConnectionId` scope is handled cross-instance.
- `getClientContext` reads the currently stored value with no side effects; returns `undefined` if the connection is unknown or has not sent context yet.

## 6. Storage

`clientContext` is stored in the same per-channel map entry the group already keeps for `meta`/`topics`, keyed by `connectionId`:

```ts
private readonly channels = new Map<RegisteredChannel<TSignal>, {
  meta: TMeta | undefined
  clientContext: TClientContext | undefined
  topics: Set<string>
  connectionId: string
}>()
```

- Dropped along with the rest of the entry when the channel deregisters. No separate cleanup path or TTL needed.
- A reconnect produces a new `connectionId` and therefore an empty `clientContext`. On the client, this is not left to the app to remember: **`useReStale` automatically re-POSTs the current `clientContext` value whenever `status` transitions to `'open'`, including after a reconnect** (see §13.1) — the app does not need special-case logic for "resend after reconnect" vs. "send on first connect," they're the same code path.
- `clientContext` is `undefined` until the client sends a `POST /sse` with `purpose: 'CLIENT_CONTEXT'`. Connections with `clientContext: undefined` are passed to the resolver (§9) as-is — the resolver decides whether to include or skip them; the library does not skip them automatically.

## 7. Type Parameters

`SSEChannelGroup` gains a `TClientContext = unknown` generic parameter, appended as the **last** parameter in the class's existing generic parameter list. Appending at the end — rather than inserting it earlier — keeps every existing explicit instantiation (e.g. `new SSEChannelGroup<SWRSignal, unknown, 'swr'>(...)`) resolving exactly as it does today; inserting ahead of an existing positional parameter would silently rebind call sites to the wrong parameter with no compile error.

```ts
class SSEChannelGroupImplementation<
  TSignal extends InvalidateSignal = InvalidateSignal,
  TMeta = unknown,
  TTarget extends SignalTarget | SignalTarget[] | readonly SignalTarget[] = TargetForSignal<TSignal> | readonly TargetForSignal<TSignal>[],
  TBroadcastTarget extends SignalTarget | SignalTarget[] | readonly SignalTarget[] = TTarget,
  TClientContext = unknown,
> { ... }
```

```ts
/** Client-supplied, unauthenticated data. Shapes which slice of already-authorized
 *  data to return (pagination, sort, filters). Never use to determine authorization
 *  scope — derive that from `meta` or the live authenticated request only. */
type TClientContext = ...
```

## 8. `clientContextSchema`

A Standard-Schema-based option, mirroring the existing `metaSchema` option. `TClientContext` is inferred from the schema's output type, and the schema is run against the real `POST /sse` body via the same `validateStandardSchema` path `metaSchema` already uses for `meta`.

This does **not** get a standalone, non-inferring overload. The existing `SSEChannelGroupConstructor` overload set already infers multiple independent type parameters from multiple independent optional properties within a single signature — e.g. the `target` + `metaSchema` overload infers both `TTarget` (from `target`) and `TMeta` (from `metaSchema`) in one signature, with no combinatorial duplication needed for that pairing. `clientContextSchema` is threaded through the same way: add `clientContextSchema?: TSchema3 extends StandardSchemaV1<unknown, TClientContext>` as a third independently-optional inferring property to each existing overload signature (not a new signature), with `TClientContext` defaulting to `unknown` when the property is omitted.

Concretely: every one of the ~9 existing `new <...>(options: {...})` signatures in `SSEChannelGroupConstructor` gets `clientContextSchema?` added to its options type and `TClientContext` added to its type parameter list and return type — a bounded, mechanical edit across the existing set, not a new overload appended after it.

**Result:** `target` + `metaSchema` + `clientContextSchema` used together in one call should infer `TTarget`, `TMeta`, and `TClientContext` all without an explicit type argument list. If a specific overload's TS inference turns out not to resolve cleanly once implemented (three-way defaulted inference can occasionally have sharp edges not visible from reading the types), that's a compiler error to fix during implementation, not a design question to re-open.

## 9. `resolveInlineData` (the per-connection resolver)

### 9.1 Type

```ts
type InlineDataConnection<TMeta, TClientContext> = {
  readonly connectionId: string
  readonly meta: TMeta | undefined
  readonly clientContext: TClientContext | undefined
}

type InlineDataResult<TSignal extends InvalidateSignal> = {
  signal: TSignal
  /** Omit to plain-invalidate this connection using `signal` with no payload.
   *  Present to write this connection's slice of data into its cache. */
  inlineData?: JSONValue
}

type ResolveInlineData<TMeta, TClientContext, TSignal extends InvalidateSignal> = (
  connections: ReadonlyArray<InlineDataConnection<TMeta, TClientContext>>,
  payload: JSONValue
) => Map<string, InlineDataResult<TSignal>> | Promise<Map<string, InlineDataResult<TSignal>>>
```

`inlineData` is optional on `InlineDataResult`, and the resolver's contract is **exhaustive**, not sparse — see §9.3.

### 9.2 Registration

Registered once at group construction, identically on every instance:

```ts
export interface SSEChannelGroupOptions<...> {
  // ...existing options
  resolveInlineData?: ResolveInlineData<TMeta, TClientContext, TSignal>
  /** Called when `resolveInlineData`'s returned map is missing an entry for
   *  one or more connections it was given (§9.3). Delivery still proceeds for
   *  every connection that *does* have a valid entry — this hook exists so the
   *  gap is observable (logging, metrics, alerting) rather than silent, since
   *  `pushInlineData` itself does not reject for this case. Not called when
   *  the resolver throws outright (§9.3) — that rejects `pushInlineData` directly. */
  onInlineDataResolverError?: (info: {
    topic: string
    missingConnectionIds: readonly string[]
  }) => void
}
```

If `resolveInlineData` is not configured and `pushInlineData` is called, the method throws immediately with a descriptive error. Silent no-op is rejected — the developer must opt in explicitly.

### 9.3 Resolver contract

- Called **once per topic per instance** — not once per connection. All local connections for that topic on that instance are passed as a single array. This is what enables batched DB queries (fetch once, slice per connection) instead of one query per connection.
- May be sync or async.
- Returns `Map<connectionId, { signal, inlineData? }>`. Each entry carries the **full signal shape** (including `key`/`queryKey`); the resolver is responsible for producing the correct cache key per connection using its knowledge of that connection's `clientContext` — the library does not derive a key from the topic.
- **The returned map is expected to contain an entry for every `connectionId` in the `connections` array the resolver was called with.** An entry with `inlineData` set means "write this data into this connection's cache." An entry with only `signal` (no `inlineData`) means "plain-invalidate this connection using this signal, no payload." There is no third, implicit "connection I said nothing about" case — a missing entry is always a contract violation to be reported, never a silent instruction to skip.
- **Missing entries fail progressively, not the whole push.** If the returned map is missing an entry for some subset of the connections it was given, that is a resolver contract violation for *those* connections only. `pushInlineData` still delivers to every connection that *does* have a valid map entry — withholding a valid, already-computed result from connection B because the resolver forgot connection A would be strictly worse for every party but A. The missing connectionIds are reported via `onInlineDataResolverError` (§9.2) rather than silently dropped; `pushInlineData` itself does not reject for this case, since delivery to the rest of the batch genuinely succeeded. There is deliberately no implicit fallback signal invented for an unaddressed connection: `pushInlineData` never receives a base signal, and §16 rules out deriving a key from `topic`, so no such fallback could be constructed — a missing entry is reported, not guessed at.
- Connections with `clientContext: undefined` (not yet sent) are passed through as-is; the resolver decides whether to include them with data or plain-invalidate them, but it should still address them explicitly — an omitted entry for such a connection is reported the same as any other missing entry, not treated as intentional.
- **If the resolver throws, that is an instance-local total failure — not partial.** No map exists to deliver a partial result from, so no connection on *this instance* receives a signal for this call; the error propagates to the `pushInlineData` caller. This is unavoidable, and is a different failure mode from a missing entry above (a valid map that's short one connection vs. no valid map at all). Other instances are unaffected either way (§11) — this was already true before this revision, since each instance runs its resolver independently.

### 9.4 Example

```ts
const group = new SSEChannelGroup<SWRSignal, Meta, 'swr', 'swr', ClientContext>({
  target: 'swr',
  resolveInlineData: async (connections, payload) => {
    const userIds = [...new Set(connections.map(c => c.meta?.userId).filter(Boolean))]
    const todos = await db.todos.findMany({
      where: { userId: { in: userIds }, teamId: payload.teamId }
    })

    return new Map(connections.map(conn => [
      conn.connectionId,
      {
        signal: {
          target: 'swr' as const,
          key: ['todos', { page: conn.clientContext?.page ?? 0, userId: conn.meta?.userId }]
        },
        inlineData: todos
          .filter(t => t.userId === conn.meta?.userId)
          .sort((a, b) => sortBy(a, b, conn.clientContext?.sortBy ?? 'createdAt'))
          .slice(
            (conn.clientContext?.page ?? 0) * (conn.clientContext?.pageSize ?? 20),
            ((conn.clientContext?.page ?? 0) + 1) * (conn.clientContext?.pageSize ?? 20)
          )
      }
      // Every `conn` in `connections` gets an entry here — this example happens to
      // give all of them `inlineData`; a resolver that wants to plain-invalidate
      // some subset would still include an entry for those, just without `inlineData`.
    ]))
  }
})
```

## 10. `pushInlineData(topic, payload)`

New public method on `SSEChannelGroup`.

```ts
async pushInlineData(topic: string, payload: JSONValue): Promise<void>
```

**Behavior:**

1. Validates `topic` using existing `validateTopic`. Throws on blank/whitespace.
2. Validates `payload` is a `JSONValue`. Throws if not.
3. Throws if `resolveInlineData` is not configured on this group.
4. Delivers locally first (same ordering as `publishRaw`):
   - Looks up `TopicManager.channels` for `topic`. If there are no local connections for that topic, skips local delivery and proceeds to step 5.
   - Calls `resolveInlineData(localConnections, payload)`, awaiting if async. If the resolver throws, the error propagates and the call rejects — no local delivery for this push (§9.3, instance-local total failure).
   - Checks the returned map for an entry for every `connectionId` passed in. If any are missing, invokes `onInlineDataResolverError` (if configured) with the missing `connectionId`s, but proceeds to deliver to every connection that does have a valid entry — see §9.3 (progressive failure).
   - For each connection with a valid map entry: looks up the channel via `connectionIndex`, and delivers `{ ...signal, ...(inlineData !== undefined ? { inlineData } : {}) }` via `deliverToChannel`.
5. If `pubsub` is configured, publishes `{ kind: 'inlineData', topic, payload }` on `controlTopic`. This happens regardless of whether step 4 hit missing entries — a resolver bug affecting this instance's local delivery does not block other instances, which run the resolver independently and may not hit the same gap (§11).

## 11. Cross-Instance Delivery

When a `{ kind: 'inlineData', topic, payload }` message arrives on `controlTopic`:

1. Look up `TopicManager.channels` for `topic` on this instance.
2. If this instance has no connections for that topic — no-op, no throw.
3. Call `resolveInlineData(localConnections, payload)` — identical to the local path in §10, including progressive handling of a partial map (missing entries call `onInlineDataResolverError` and are skipped; present entries are still delivered) and instance-local total failure on throw.
4. Deliver signals to matching connections via `deliverToChannel`.

The resolver runs **independently on every instance** that owns connections for the topic — it is registered identically on every instance at construction, so it never needs to be serialized. Only `payload` crosses the wire; `meta`, `clientContext`, and all connection state stay local to their owning instance. This is both the correct architecture for a horizontally-scaled deployment and a desirable security property. Self-echo suppression at the envelope layer means the originating instance's own `pubsub.publish` in §10 step 5 does not cause it to re-run its local delivery a second time.

Because each instance's resolver call is independent, delivery was already partial at the cross-instance level even before §9.3's revision: one instance's resolver throwing does not affect another instance's delivery to its own connections. Progressive handling of missing map entries (§9.3) makes the within-instance behavior consistent with this — a gap in one connection's entry no longer withholds delivery from every other connection on the same instance, matching how a gap on one instance already didn't withhold delivery on another.

## 12. `initControlSubscription` Changes

The existing subscriber dispatches on `msg.kind`. Add:

```ts
if (msg.kind === 'inlineData') {
  await this.handleInlineDataMessage(msg)
}
```

The subscriber callback becomes async for this branch. The existing `revokeByConnectionId` and `revokeWhere` branches remain synchronous.

## 13. Client-Side: `clientContext` Registration

### 13.1 React — `useReStale`

```ts
export interface UseReStaleOptions<...> {
  // ...existing options
  /** Client-supplied context sent to the server via POST /sse.
   *  Re-sent whenever this value changes (deep-compared), and automatically
   *  re-sent on every transition to `status: 'open'` — including after a
   *  reconnect, since a reconnect gets a fresh connectionId with no stored
   *  context server-side (§6). The developer never touches connectionId or
   *  useEffect manually, and never needs reconnect-specific logic. */
  clientContext?: JSONValue
  /** URL to POST client context to. Defaults to the same URL as the SSE stream.
   *  Override only if the POST endpoint differs from the GET endpoint. */
  clientContextUrl?: string
  /** Controls retry behavior for the `POST /sse` context sync when a request
   *  fails (e.g. a `404` because the SSE connection hasn't finished
   *  registering yet). */
  clientContextSync?: {
    /** Total POST attempts per sync, including the first. Default: 2
     *  (one initial attempt, one retry). */
    maxAttempts?: number
    /** Delay between attempts, in ms. Default: 200. */
    retryDelayMs?: number
    /** What happens once `maxAttempts` is exhausted for a given value:
     *  - `'retryOnNextChange'` (default): give up on syncing this particular
     *    value, but sync normally the next time `clientContext` changes or
     *    the connection reopens. A logged warning either way.
     *  - `'disableUntilReconnect'`: stop attempting `clientContext` syncs
     *    entirely until the SSE connection reconnects (new `connectionId`).
     *    Use this if repeated failures likely indicate a systemic problem
     *    (e.g. the POST endpoint itself is down) rather than a one-off race. */
    onExhausted?: 'retryOnNextChange' | 'disableUntilReconnect'
  }
}
```

**Behavior:**
- When `status` transitions to `'open'` — including after a reconnect — if `clientContext` is set, the hook automatically fires `POST /sse` with `{ purpose: 'CLIENT_CONTEXT', connectionId, clientContext }`.
- When `clientContext` changes (deep-compared) while already `'open'`, the hook fires another `POST /sse` with the updated value.
- On a `404` response, retries per `clientContextSync` (default: one retry after 200ms). Behavior after exhausting attempts follows `clientContextSync.onExhausted` (default `'retryOnNextChange'`). `onInvalidate` behavior is unaffected either way.
- No loading state, no error callback — fire-and-forget with the configurable retry safety net above.

```ts
const onInvalidate = useSwrAdapter(mutate, { markInlineDataStale: false })

useReStale('/api/sse', {
  onInvalidate,
  clientContext: { page: currentPage, pageSize: 20, sortBy: currentSort },
  // clientContextUrl: '/sse'  // optional — defaults to same URL
  // clientContextSync: { maxAttempts: 3, onExhausted: 'disableUntilReconnect' }  // optional
})
```

No `useEffect`, no manual `connectionId`. Changing `currentPage`/`currentSort` re-registers context transparently.

### 13.2 Non-React — `SSEInvalidatorClient`

```ts
async updateClientContext(clientContext: JSONValue): Promise<{ updated: boolean }>
```

- POSTs `{ purpose: 'CLIENT_CONTEXT', connectionId: this.connectionId, clientContext }` to the SSE URL (or `clientContextUrl` if configured at construction).
- Returns `{ updated: true }` on `204`, `{ updated: false }` on `404`.
- Throws on network error or any other status. Does not retry — the caller decides what to do with `{ updated: false }`. (`clientContextSync` is a `useReStale`-only convenience; the non-React client leaves retry policy entirely to the caller, consistent with its lower-level surface elsewhere.)

`ClientOptions` gains an optional `clientContextUrl?: string`, defaulting to the SSE stream URL.

```ts
const client = new SSEInvalidatorClient('/api/sse', { target: 'swr', onInvalidate })
await client.connect()

// Call whenever local state changes
await client.updateClientContext({ page: 2, pageSize: 20, sortBy: 'createdAt' })
```

## 14. Client Adapter Changes

### 14.1 `markInlineDataStale` — an adapter-level option, not a `ClientOptions` field

`markInlineDataStale` is declared on each adapter factory's own options type — `UseSwrAdapterOptions` and `TanstackQueryAdapterOptions` — **not** on the shared `ClientOptions` used by `useReStale`/`SSEInvalidatorClient`.

This placement is required, not stylistic: `useReStale` and `SSEInvalidatorClient` only ever see a signal and hand it to whatever `onInvalidate` callback the developer supplied — they have no reference to the adapter's internal write call and no wiring path to pass a shared option down into it. Only the adapter factory itself calls `setQueryData`/`mutate`, so only the adapter factory can act on this option. A field on `ClientOptions` would type-check but silently do nothing.

```ts
export interface UseSwrAdapterOptions {
  // ...existing options
  /** Whether `inlineData` is marked stale immediately after being written to
   *  the cache, triggering SWR's normal revalidation path.
   *  Default: true.
   *  - true: write inlineData to cache, then mark it stale.
   *  - false: write inlineData to cache and stop. Trust the push entirely. */
  markInlineDataStale?: boolean
}

export interface TanstackQueryAdapterOptions {
  // ...existing options
  /** Same semantics as `UseSwrAdapterOptions.markInlineDataStale`, applied via
   *  `invalidateQueries` instead of SWR's `revalidate`. Default: true. */
  markInlineDataStale?: boolean
}
```

This is a data-consistency/UX setting with no security dimension: any data sent to the client is already visible in the client runtime and via network inspection regardless of whether or when it's applied to a cache.

### 14.2 Exact-match rule for `inlineData` writes

The library elsewhere supports prefix, hierarchical, and object-subset key matching for plain invalidation signals. `inlineData` must **not** inherit that broad matching: the resolver (§9) computes one concrete value for one specific cache entry per connection, using that connection's own `clientContext`. Writing that value into every cache entry a broader filter happens to match would apply one connection-specific slice of data to unrelated entries.

**Rule:** the cache write always targets the resolver-provided key as an **exact** match, regardless of what matching mode the signal's own `action`/filters would otherwise use. If `markInlineDataStale` is enabled, the follow-up staleness marking is *also* scoped to that same exact key — not the signal's normal (possibly broader) invalidation filters. A signal's ordinary broad-match invalidation behavior is unaffected when it carries no `inlineData`.

Rationale: broadening either step reintroduces the two failure modes this rule exists to prevent — writing one connection's slice into a sibling cache entry it doesn't describe, or leaving that same sibling both stale and silently unrefreshed because the exact-write path skipped it.

### 14.3 SWR adapter

**New interface surface required:** `SWRMutator` currently has no overload matching a bare `mutate(key)` call (its existing forms are matcher-function-first or require a `data`/`options` pair). Add:

```ts
export interface SWRMutator {
  // ...existing overloads
  (key: Arguments): Promise<unknown>
}
```

When `signal.inlineData` is present and `signal.action` is **not** `'remove'` or `'purge'`:
```ts
mutate(signal.key, signal.inlineData, { revalidate: false })
if (markInlineDataStale ?? true) {
  await mutate(signal.key) // exact key only — no matcher-function form; uses the new bare-key overload above
}
```
When `action` is `'remove'` or `'purge'`, `inlineData` is ignored; falls through to existing action behavior, which retains its existing (possibly matcher-based) key resolution.

### 14.4 TanStack Query adapter

**New interface surface required:** `QueryClientLike` does not currently declare `setQueryData`. Add:

```ts
export interface QueryClientLike {
  // ...existing methods
  setQueryData(queryKey: QueryKey, data: unknown): void
}
```

When `signal.inlineData` is present and `signal.action` is **not** `'remove'`, `'reset'`, or `'cancel'`:
```ts
queryClient.setQueryData(queryKey, signal.inlineData) // always exact — setQueryData's only mode
if (markInlineDataStale ?? true) {
  void queryClient.invalidateQueries({ queryKey, exact: true }) // exact:true, ignoring any broader `filters`
}
```
When `action` is `'remove'`, `'reset'`, or `'cancel'`, `inlineData` is ignored; falls through to existing action behavior, which retains its existing (possibly prefix-based) `filters`.

### 14.5 Generic adapter

No special handling. `inlineData` is surfaced on the raw signal the listener receives; no automatic cache write, since there is no cache to write to.

## 15. Security Invariant

Authorization scope is always derived from `meta` or the live authenticated request handling a mutation — **never** from `clientContext`. This is a documented invariant enforced by naming (`clientContext`, not `context`) and by type narrowing (`TClientContext` excludes any authorization-relevant fields the developer doesn't explicitly add). It is not enforced by any runtime mechanism in the library, since authorization scope is application-specific and cannot be inferred generically.

`meta` and `clientContext` never leave their owning instance in a multi-instance deployment — only `payload` travels over pubsub (§11). `updateClientContext` enforces scope-pinning via `options.scope`, same semantics as `revokeByConnectionId` (§5).

## 16. Non-Goals

- No automatic stripping of `clientContext` keys that collide with `meta` keys — this would guess at developer intent and could silently discard data added deliberately.
- No capability-scoped query-builder API separating "scope" and "shape" computation into non-composable phases. Correct use of `meta` vs. `clientContext` is an ordinary application-level access-control responsibility.
- No client-side gating or delayed rendering tied to trust level. Data sent to the client is visible the moment it's sent, regardless of client-side logic applied afterward.
- No signal-level override of `markInlineDataStale` — the per-adapter setting (§14.1) is sufficient; per-signal override adds complexity for negligible gain.
- No library-level key derivation from topic — the resolver owns the full signal shape including the cache key. (This is also why an "implicit fallback signal" for connections a resolver doesn't explicitly address was rejected in favor of the exhaustiveness rule in §9.3 — there was never a legal source for that signal.)
- No *silent* partial resolver output — see §9.3. A connection missing from the resolver's returned map is always reported via `onInlineDataResolverError`, never treated as an implicit "do nothing" instruction. What's explicitly in scope, by contrast, is *reported* partial delivery: a resolver bug affecting some connections does not withhold a valid, already-computed result from the rest of the batch.
- No built-in debouncing of `POST /sse` context updates when `clientContext` changes rapidly — a client concern.
- No library enforcement of `payload` size — the developer's responsibility.
- No runtime reconfiguration of connection-level transport options (`autoReconnect`, reconnect backoff, `debug`) without recreating the connection. This is a separate, unrelated concern — it does not touch `clientContext`, `inlineData`, or any resolver — and has its own spec. An implementor should not assume this document covers it.

## 17. What Does NOT Change

- `deliverToChannel`, `broadcastRaw`, `publishRaw`, `TopicManager` — unchanged.
- `channel.ts` / `invalidate()` — unchanged; `inlineData` is just another field on the signal object, serialized over SSE like any other field.
- `revokeByConnectionId`, `revokeWhere` — unchanged.
- `PubSubAdapter` interface — unchanged. The new `inlineData` kind is a new member of the `PubSubMessage` union, which `publish`/`subscribe` already accept as `PubSubMessage<TSignal>`.
- `connectionId` ↔ channel remains 1:1 — this is an existing invariant of the codebase, not something newly introduced or newly relied upon by this spec.
- Pubsub self-echo suppression (`unwrapEnvelope`) — existing behavior, relied upon by §5 and §11, not modified.

## 18. Testing Strategy

### 18.1 Load-bearing test rules

A test only counts if it can actually fail when the implementation is wrong:

- **Every `@ts-expect-error` needs a passing sibling right next to it** — an isolated one only proves *something* errors, not that the *right* thing does.
- **Use `expectTypeOf(x).toEqualTypeOf<T>()`, not `toMatchTypeOf`/assignability checks**, wherever the goal is "this is exactly this shape" — assignability checks pass for wider/narrower types too.
- **No `any` in a type test** — construct values structurally or via `{} as ExactType`, never `any`.
- **Runtime tests assert on observable state, not call counts alone** — prefer the actual stored/returned/delivered value over `toHaveBeenCalled()`.

### 18.2 Required coverage

**Type-level (`*.test-d.ts`):**
- `updateClientContext` rejects a `clientContext` with an unknown key or a wrong-typed known key; accepts one matching `TClientContext`.
- `TClientContext` is correctly inferred from `clientContextSchema` with no explicit type argument, and excludes fields absent from the schema's output type.
- `updateClientContext`'s `scope` option is typed as `Partial<TMeta>` (or the same conditional form `revokeByConnectionId` uses), same guarantee as `revokeByConnectionId`'s scope (typo'd keys rejected).
- `updateClientContext` returns `Promise<{ updated: boolean }>`.
- `TClientContext` defaults to `unknown` and imposes no shape when omitted.
- **`target` + `metaSchema` + `clientContextSchema` used together in a single constructor call infer `TTarget`, `TMeta`, and `TClientContext` with no explicit type argument list** — a passing (non-`@ts-expect-error`) test is required here, per §8.
- `inlineData?: JSONValue` on `TanStackQuerySignal`/`SWRSignal`/`GenericInvalidateSignal` rejects non-JSON values (e.g. functions); `SWRSignal['inlineData']` and `TanStackQuerySignal['inlineData']` share the same type.
- `resolveInlineData`'s `connections` and `payload` parameters are correctly typed against `TMeta`/`TClientContext`/`JSONValue`; its return type must be `Map<string, InlineDataResult<TSignal>>` or a `Promise` thereof — a resolver returning the wrong shape is a type error. `InlineDataResult['inlineData']` is optional — a resolver returning `{ signal }` alone (no `inlineData`) type-checks; a resolver returning `{ inlineData }` alone (no `signal`) does not.
- `UseSwrAdapterOptions.markInlineDataStale` and `TanstackQueryAdapterOptions.markInlineDataStale` each accept `boolean | undefined` and reject non-boolean. `ClientOptions` does **not** declare `markInlineDataStale` — a `@ts-expect-error` sibling confirms passing it to `useReStale`/`SSEInvalidatorClient` directly is a type error.
- `UseReStaleOptions.clientContextSync` accepts `{ maxAttempts?, retryDelayMs?, onExhausted? }`; `onExhausted` rejects any string outside `'retryOnNextChange' | 'disableUntilReconnect'`.

**Runtime (`channel-group.test.ts`):**
- `updateClientContext` stores the value locally, retrievable via `getClientContext`.
- Returns `{ updated: false }` for an unknown `connectionId`, without throwing.
- Scope mismatch rejects the update (`updated: false`, no stored value); scope match applies it — same semantics as `revokeByConnectionId`.
- A `clientContextSchema` validation failure throws `SchemaValidationError` and does not partially apply.
- Cross-instance: an update published via `controlTopic` is applied only by the owning instance; a non-owning instance receiving the message with no matching connection is a no-op, not a throw.
- `clientContext` is cleared when the connection deregisters.
- `pushInlineData` throws if `resolveInlineData` is not configured.
- `pushInlineData` calls the resolver once with all local connections for the topic, and delivers the resolver's per-connection `signal` (+ `inlineData` when present) to the matching channels — assert on actual delivered signal content, not just that the resolver was called.
- A resolver entry with `signal` but no `inlineData` results in a delivered signal with no `inlineData` field (plain invalidation via the exhaustive-map path, not the old "absent from map" path).
- **If the resolver's returned map is missing an entry for some (not all) connections it was given, `pushInlineData` still delivers a signal to every connection that has a valid map entry, does not reject, and calls `onInlineDataResolverError` with exactly the missing `connectionId`s** (§9.3 progressive-failure contract).
- `pushInlineData` propagates cross-instance: an instance that owns a matching connection but didn't originate the call still invokes its own local resolver and delivers locally; a missing-entry gap on one instance does not affect another instance's delivery to its own connections.
- If the resolver throws, `pushInlineData` rejects and **no connection on that instance** receives a signal for that call (instance-local total failure — no map exists to deliver a partial result from); `onInlineDataResolverError` is not called in this case, since there is no map to inspect for gaps.
- If `onInlineDataResolverError` is not configured and the map is missing entries, delivery to valid connections still proceeds without throwing (the hook is for observability only, not a required error boundary).

**HTTP layer:**
- `POST /sse` with `purpose: 'CLIENT_CONTEXT'` and a known `connectionId` returns `204` and stores the context.
- Unknown `connectionId` returns `404`.
- Missing/unrecognized `purpose` returns `400`.
- A `clientContextSchema` validation failure surfaces as `400` when the example route's `try/catch` pattern (§4) is followed.

**Adapters (`swr/adapter.test.ts`, `tanstack-query/adapter.test.ts`):**
- SWR: `inlineData` triggers `mutate(key, inlineData, { revalidate: false })`; when `markInlineDataStale` is `true` (default), a follow-up bare `mutate(key)` fires for that exact key only, via the new `SWRMutator` overload — never the matcher-function form; ignored when `action` is `'remove'`/`'purge'`.
- TanStack: `inlineData` triggers `setQueryData(queryKey, inlineData)` via the new `QueryClientLike.setQueryData`, followed by `invalidateQueries({ queryKey, exact: true })` only when `markInlineDataStale` is `true`; ignored when `action` is `'remove'`/`'reset'`/`'cancel'`.
- **Regression case (both adapters):** a signal whose `key`/`queryKey` would, under the adapter's *plain-invalidation* path, match multiple cache entries via prefix/hierarchical matching, is delivered instead with `inlineData` set. Assert the write touches only the exact entry, and — when `markInlineDataStale` is `true` — the follow-up staleness marking also only touches that exact entry, leaving sibling entries neither overwritten nor marked stale by this signal.
- Signals without `inlineData` fall through to existing invalidate-only behavior, including its existing prefix/hierarchical matching, unchanged, for both adapters.

**Client (`useReStale`, integration-level per §18.3):**
- `clientContext` is auto-POSTed on transition to `status: 'open'`, including after a simulated reconnect (new `connectionId`).
- `clientContextSync.maxAttempts`/`retryDelayMs` are honored (attempt count and timing observable via mocked fetch).
- `onExhausted: 'retryOnNextChange'` (default) resumes syncing on the next `clientContext` change after exhausting attempts; `'disableUntilReconnect'` does not resume until a reconnect occurs.

### 18.3 Coverage deliberately not addressed

- Whether a specific connection receives the "correct" per-user data slice — this is application-level authorization the library cannot verify generically. What the library's own tests *do* cover: that `clientContext`'s type/shape is constrained to what the developer declared, that scope-pinning rejects a mismatched `connectionId` update, and that the resolver's exhaustiveness contract (§9.3) is enforced.
- `payload` size enforcement — outside library scope.
- Precise timing/jitter behavior of `clientContextSync` retries beyond attempt count and basic delay — integration-test territory, not unit test.
