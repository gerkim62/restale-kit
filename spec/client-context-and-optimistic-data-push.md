# Spec: Client Context and Optimistic Data Push

**Package:** restale-kit
**Area:** `server/core/channel-group.ts`, `types/protocol.ts`, `client/core`, `client/swr`, `client/tanstack-query`
**Status:** Proposed

## 1. Overview

Signals may carry a data payload in addition to (or instead of) a plain invalidation. The server computes this payload per connection, using that connection's authenticated identity and its currently registered client context (pagination, sort, filters), and pushes it directly so the client can write it into its cache without an intermediate refetch.

## 2. Terminology

Two distinct concepts exist per connection, and they must never be conflated:

| | `meta` | `clientContext` |
|---|---|---|
| Set by | Server, from the authenticated request, at connect time | Client, via `POST /sse` |
| Trust level | Authoritative for identity | Untrusted — shapes queries only |
| Purpose | Determines **what a connection is allowed to see** | Determines **which slice of that allowed data to return** (page, sort, filter) |
| Mutable after connect | No (fixed for the connection's lifetime) | Yes, via `updateClientContext` |

`clientContext` must never be used to determine authorization scope. Authorization is always derived from `meta` or, preferably, the live authenticated request handling the mutation that triggers a push. This is stated in the JSDoc on `TClientContext` itself, not only in this document.

## 3. Protocol Changes

`optimisticData?: JSONValue` is added to `TanStackQuerySignal` and `GenericInvalidateSignal`, matching the field already present on `SWRSignal`. All signal types that support data push share this one field name.

```ts
export interface TanStackQuerySignal extends BaseInvalidateSignal {
  target?: typeof SIGNAL_TARGETS.TANSTACK_QUERY
  queryKey: JSONValue[]
  exact?: QueryFilters['exact']
  type?: QueryFilters['type']
  action?: TanStackQueryAction
  stale?: boolean
  optimisticData?: JSONValue
}
```

This is a breaking change to the signal type surface and is accepted as such.

## 4. Client Option: `revalidateOptimisticData`

```ts
export interface ClientOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  // ...existing options
  /** Whether `optimisticData` on an incoming signal is followed by a background
   *  revalidation against the source of truth, or applied and left as-is.
   *  Default: true. */
  revalidateOptimisticData?: boolean
}
```

Adapter behavior:
- **SWR:** `mutate(key, optimisticData, { revalidate: revalidateOptimisticData })`.
- **TanStack Query:** `queryClient.setQueryData(queryKey, optimisticData)`, followed by `queryClient.invalidateQueries(...)` when `revalidateOptimisticData` is `true`.
- **Generic listener:** `optimisticData` is surfaced on the raw signal; no automatic cache write, since there is no cache to write to.

This option is a data-consistency and UX setting. It has no security dimension: any data sent to the client is already visible in the client runtime and via network inspection regardless of whether or when it is applied to a cache.

## 5. Transport

Client context is submitted over `POST /sse` — the same path used by the existing `GET /sse` stream endpoint, dispatched by HTTP method. This inherits whatever auth/CORS middleware is already mounted on that path.

```ts
app.get('/sse', (req, res) => {
  group.attachNodeResponse(req, res, { meta: getMeta(req) })
})

app.post('/sse', async (req, res) => {
  const { connectionId, clientContext } = req.body
  await group.updateClientContext(connectionId, clientContext, { scope: getScope(req) })
  res.status(204).end()
})
```

## 6. Storage

`clientContext` is stored in the same per-channel map entry the group already keeps for `meta`/`topics`, keyed by `connectionId`.

```ts
private readonly channels = new Map<RegisteredChannel<TSignal>, {
  meta: TMeta | undefined
  clientContext: TClientContext | undefined
  topics: Set<string>
  connectionId: string
}>()
```

It is dropped along with the rest of the entry when the channel deregisters. No separate cleanup path or TTL is needed. A reconnect produces a new `connectionId` and therefore an empty `clientContext`; the client is expected to resend its current context after reconnecting.

## 7. `updateClientContext` and `getClientContext`

```ts
async updateClientContext(
  connectionId: string,
  clientContext: TClientContext,
  options?: { scope?: Record<string, JSONValue> }
): Promise<{ updated: boolean }>

getClientContext(connectionId: string): TClientContext | undefined
```

- `updateClientContext` looks up the connection via the existing `connectionIndex` (`Map<connectionId, Set<channel>>`), the same index used by `revokeByConnectionId`, and updates the entry for every channel registered under that `connectionId`.
- If `options.scope` is provided, it is matched against the connection's stored `meta` before the update is applied, using the same matching already used for `revokeByConnectionId`. This is required, not optional: `connectionId` is unique but not secret — it is a client-generated value sent as a URL query param, visible in network tools, logs, and referrers, and is not cryptographically bound to any session. Without scope-pinning, any caller who has observed a `connectionId` could overwrite that connection's `clientContext`, regardless of whether they own it.
- If `clientContextSchema` is configured, the incoming `clientContext` is validated the same way `validateMeta` validates `meta` before storage; a failing validation rejects the update with the same error type `metaSchema` failures already raise, and does not partially apply.
- In multi-instance deployments (a `pubsub` adapter configured), the update is additionally published on the existing `controlTopic`. Every instance is subscribed to `controlTopic` and checks `connectionIndex` locally; only the instance that owns the connection applies the update. This reuses the mechanism already in place for `revokeByConnectionId` and requires no new infrastructure. Receiving instances re-validate the incoming payload against their local `clientContextSchema` if configured before applying.
- `getClientContext` reads the currently stored value for a `connectionId` with no side effects; returns `undefined` if the connection is unknown or has no context set yet.

## 8. Type Parameters

`SSEChannelGroup` gains a `TClientContext` generic parameter, appended **after** the existing `TTarget`, not before it. Positional order matters here: `TTarget` is already used positionally in real call sites (e.g. `new SSEChannelGroup<SWRSignal, unknown, 'swr'>(...)`), so inserting a new parameter ahead of it would silently rebind those call sites' third argument to the wrong parameter — no compile error, just quietly wrong. Appending at the end keeps every existing 1-, 2-, and 3-argument explicit instantiation resolving exactly as it does today, with `TClientContext` defaulting to `unknown` when omitted.

```ts
class SSEChannelGroupImplementation<
  TSignal extends InvalidateSignal,
  TMeta = unknown,
  TTarget extends SignalTarget | SignalTarget[] | readonly SignalTarget[] = TargetForSignal<TSignal> | readonly TargetForSignal<TSignal>[],
  TClientContext = unknown,
> { ... }
```

```ts
/** Client-supplied, unauthenticated data. Shapes which slice of already-authorized
 *  data to return (pagination, sort, filters). Never use to determine authorization
 *  scope — derive that from `meta` or the live authenticated request only. */
type TClientContext = ...
```

## 9. `clientContextSchema`

A Standard-Schema-based option, mirroring `metaSchema`, given its own standalone constructor overload:

```ts
new <TSignal extends InvalidateSignal, TClientContext, TSchema extends StandardSchemaV1<unknown, TClientContext>>(
  options: { clientContextSchema: TSchema } & SSEChannelGroupOptions<TSignal, unknown, TargetForSignal<TSignal> | readonly TargetForSignal<TSignal>[], TClientContext>
): SSEChannelGroup<TSignal, unknown, TargetForSignal<TSignal> | readonly TargetForSignal<TSignal>[], TClientContext>
```

`TClientContext` is inferred from the schema, and the schema is run against the real `POST /sse` body via `validateStandardSchema` before storage — the same validation path `metaSchema` already uses for `meta`.

This overload is standalone rather than crossed with every existing `target`/`metaSchema` overload combination, to avoid multiplying an already large overload set for a rare combination. Using `target`, `metaSchema`, and `clientContextSchema` together in one call requires an explicit `<TSignal, TMeta, TTarget, TClientContext>` type argument list rather than relying on inference from `clientContextSchema` alone.

## 10. Security Invariant

Authorization scope is always derived from `meta` or the live authenticated request handling a mutation — never from `clientContext`. This is a documented invariant enforced by naming (`clientContext`, not `context`) and by type narrowing (`TClientContext` excludes any authorization-relevant fields the developer does not explicitly add to it); it is not enforced by any runtime mechanism in the library, since authorization scope is application-specific and cannot be inferred generically.

## 11. Non-Goals

- No automatic stripping of `clientContext` keys that collide with `meta` keys. This would guess at developer intent and could silently discard data the developer added deliberately.
- No capability-scoped query-builder API separating "scope" and "shape" computation into non-composable phases. This is out of scope for the library; correct use of `meta` versus `clientContext` is an ordinary access-control responsibility of the application, the same as any other authorization decision in a web application.
- No client-side gating or delayed rendering tied to trust level. Data sent to the client is visible in the client runtime the moment it is sent, regardless of any client-side logic applied afterward; there is no client-side mechanism that functions as a security boundary.

## 12. Out of Scope

The mechanism for computing `optimisticData` per connection from `meta` and `clientContext`, and unicasting it to the matching connection instead of group-broadcasting, is not specified here and is left for a follow-up spec.

## 13. Testing Strategy

### 13.1 What makes a test here load-bearing, not decorative

A test for this feature only counts if it can actually fail when the implementation is wrong. Four rules, applied to every test below:

- **Every `@ts-expect-error` needs a passing sibling right next to it.** An isolated `@ts-expect-error` proves *something* errors, not that the *right* thing errors — it passes identically whether the real bug is fixed or whether an unrelated typo elsewhere broke the whole expression. Pairing a valid call with an invalid one that differs by exactly one field isolates what's actually being checked.
- **`expectTypeOf(x).toEqualTypeOf<T>()` over `toMatchTypeOf`/assignability checks**, wherever the goal is "this is exactly this shape," because assignability checks pass for wider or narrower types too — they can go green while the inferred type silently drifts from what's intended.
- **No `any` in a type test.** `any` is assignable to and from everything, so a test that types a value `as any` before passing it somewhere will pass regardless of whether the real constraint holds. If a test needs a value of "some shape," construct it structurally or via `{} as ExactType`, never `any`.
- **Runtime tests assert on observable state, not on internal call counts alone.** `expect(spy).toHaveBeenCalled()` can pass even if it was called with the wrong arguments. Prefer asserting on the actual stored/returned value (`entry.clientContext`, the resolved cache value, the rejected promise's message) so the test fails if the *content* is wrong, not only if the call is missing entirely.

### 13.2 Type-level tests (`channel-group.test-d.ts` additions)

```ts
describe('SSEChannelGroup clientContext type safety', () => {
  test('updateClientContext requires clientContext matching TClientContext', () => {
    interface PushContext { page?: number; sortBy?: string }
    const group = new SSEChannelGroup<TanStackQuerySignal, unknown, PushContext>({ target: 'tanstack-query' })

    // Valid — matches TClientContext shape
    void group.updateClientContext('conn-1', { page: 2, sortBy: 'createdAt' })

    // @ts-expect-error unknown key not present on TClientContext
    void group.updateClientContext('conn-1', { page: 2, userId: 'spoofed' })

    // @ts-expect-error wrong value type for a known key
    void group.updateClientContext('conn-1', { page: 'two' })
  })

  test('TClientContext is inferred from clientContextSchema without an explicit type argument', () => {
    type PushContext = { page?: number }
    const clientContextSchema = {} as StandardSchemaV1<unknown, PushContext>
    const group = new SSEChannelGroup({ clientContextSchema })

    expectTypeOf(group).toEqualTypeOf<SSEChannelGroup<InvalidateSignal, unknown, PushContext>>()
    void group.updateClientContext('conn-1', { page: 2 })

    // @ts-expect-error inferred TClientContext excludes fields absent from the schema's output type
    void group.updateClientContext('conn-1', { page: 2, userId: 'spoofed' })
  })

  test('updateClientContext scope is typed against Partial<TMeta>, same as revokeByConnectionId', () => {
    interface UserMeta { userId: number; role?: string }
    interface PushContext { page?: number }
    const group = new SSEChannelGroup<TanStackQuerySignal, UserMeta, PushContext>({ target: 'tanstack-query' })

    void group.updateClientContext('conn-1', { page: 2 }, { userId: 123 })

    // @ts-expect-error key typo rejected by compiler, same guarantee as revokeByConnectionId's scope
    void group.updateClientContext('conn-1', { page: 2 }, { user_id: 123 })
  })

  test('updateClientContext returns Promise<{ updated: boolean }>', () => {
    const group = new SSEChannelGroup<TanStackQuerySignal, unknown, { page?: number }>({ target: 'tanstack-query' })

    expectTypeOf(group.updateClientContext('conn-1', { page: 1 })).toEqualTypeOf<Promise<{ updated: boolean }>>()
  })

  test('TClientContext defaults to unknown and imposes no shape when omitted', () => {
    const group = new SSEChannelGroup<TanStackQuerySignal>({ target: 'tanstack-query' })

    expectTypeOf(group).toEqualTypeOf<SSEChannelGroup<TanStackQuerySignal, unknown, unknown>>()
  })
})
```

```ts
// protocol.test-d.ts additions
describe('optimisticData on push-capable signals', () => {
  test('TanStackQuerySignal accepts optimisticData as JSONValue, rejects non-JSON values', () => {
    const valid: TanStackQuerySignal = { queryKey: ['todos'], optimisticData: { id: 1, done: true } }
    expectTypeOf(valid).toMatchTypeOf<TanStackQuerySignal>()

    // @ts-expect-error functions are not valid JSONValue
    const invalid: TanStackQuerySignal = { queryKey: ['todos'], optimisticData: () => {} }
  })

  test('SWRSignal.optimisticData and TanStackQuerySignal.optimisticData share the same JSONValue type', () => {
    expectTypeOf<SWRSignal['optimisticData']>().toEqualTypeOf<TanStackQuerySignal['optimisticData']>()
  })
})
```

```ts
// client-contracts.test-d.ts (or sse-client.test-d.ts) additions
describe('ClientOptions.revalidateOptimisticData', () => {
  test('accepts boolean, defaults are respected at the call site, rejects non-boolean', () => {
    const opts: ClientOptions<TanStackQuerySignal> = { revalidateOptimisticData: false }
    expectTypeOf(opts.revalidateOptimisticData).toEqualTypeOf<boolean | undefined>()

    // @ts-expect-error must be boolean, not string
    const bad: ClientOptions<TanStackQuerySignal> = { revalidateOptimisticData: 'false' }
  })
})
```

### 13.3 Runtime tests (`channel-group.test.ts` additions)

```ts
describe('updateClientContext', () => {
  it('stores clientContext locally, retrievable via getClientContext', async () => {
    const group = new SSEChannelGroup<any, TestMeta, { page: number }>()
    const ch = createSSEChannel({ target: 'swr', connectionId: 'conn-ctx-1' })
    group.register(ch, { userId: 100 })

    const result = await group.updateClientContext(ch.connectionId, { page: 2 })

    expect(result.updated).toBe(true)
    expect(group.getClientContext(ch.connectionId)).toEqual({ page: 2 })
  })

  it('returns updated: false for an unknown connectionId, and does not throw', async () => {
    const group = new SSEChannelGroup<any, TestMeta, { page: number }>()

    const result = await group.updateClientContext('does-not-exist', { page: 1 })

    expect(result.updated).toBe(false)
  })

  it('enforces scope checks against stored meta, same semantics as revokeByConnectionId', async () => {
    const group = new SSEChannelGroup<any, TestMeta, { page: number }>()
    const ch = createSSEChannel({ target: 'swr', connectionId: 'conn-ctx-2' })
    group.register(ch, { userId: 100, role: 'admin' })

    const mismatched = await group.updateClientContext(ch.connectionId, { page: 5 }, { userId: 999 })
    expect(mismatched.updated).toBe(false)
    expect(group.getClientContext(ch.connectionId)).toBeUndefined()

    const matched = await group.updateClientContext(ch.connectionId, { page: 5 }, { userId: 100 })
    expect(matched.updated).toBe(true)
    expect(group.getClientContext(ch.connectionId)).toEqual({ page: 5 })
  })

  it('validates clientContext against clientContextSchema and throws SchemaValidationError on invalid input', async () => {
    const clientContextSchema = createInvalidSchema('Invalid clientContext')
    const group = new SSEChannelGroup<any, TestMeta, { page: number }>({ clientContextSchema })
    const ch = createSSEChannel({ target: 'swr', connectionId: 'conn-ctx-3' })
    group.register(ch, { userId: 100 })

    await expect(group.updateClientContext(ch.connectionId, { page: -1 })).rejects.toThrow(SchemaValidationError)
    // Rejected update must not partially apply
    expect(group.getClientContext(ch.connectionId)).toBeUndefined()
  })

  it('propagates updates cross-instance via the control topic, applied only by the owning instance', async () => {
    const pubsub = new MemoryPubSubAdapter()
    const ownerGroup = new SSEChannelGroup<any, TestMeta, { page: number }>({ pubsub })
    const otherGroup = new SSEChannelGroup<any, TestMeta, { page: number }>({ pubsub })
    const ch = createSSEChannel({ target: 'swr', connectionId: 'conn-ctx-remote' })
    ownerGroup.register(ch, { userId: 100 })
    await ownerGroup['controlPendingOp']
    await otherGroup['controlPendingOp']

    await ownerGroup.updateClientContext(ch.connectionId, { page: 3 })

    // Owning instance applied it locally
    expect(ownerGroup.getClientContext(ch.connectionId)).toEqual({ page: 3 })
    // Non-owning instance received the control message but has no matching connection — no-op, no throw
    expect(otherGroup.getClientContext(ch.connectionId)).toBeUndefined()
  })

  it('clears clientContext when the connection deregisters', async () => {
    const group = new SSEChannelGroup<any, TestMeta, { page: number }>()
    const ch = createSSEChannel({ target: 'swr', connectionId: 'conn-ctx-4' })
    group.register(ch, { userId: 100 })
    await group.updateClientContext(ch.connectionId, { page: 1 })

    group.deregister(ch)

    expect(group.getClientContext(ch.connectionId)).toBeUndefined()
  })
})
```

### 13.4 Adapter runtime tests (`tanstack-query/adapter.test.ts`, `swr/adapter.test.ts` additions)

```ts
describe('optimisticData with revalidateOptimisticData', () => {
  it('TanStack: writes optimisticData via setQueryData, then invalidates when revalidateOptimisticData is true (default)', () => {
    const setQueryData = vi.fn()
    const invalidateQueries = vi.fn()
    const queryClient = { setQueryData, invalidateQueries } as any

    const onInvalidate = createTanStackAdapter(queryClient)
    onInvalidate({ target: 'tanstack-query', queryKey: ['todos'], optimisticData: { id: 1 } })

    expect(setQueryData).toHaveBeenCalledWith(['todos'], { id: 1 })
    expect(invalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['todos'] }))
  })

  it('TanStack: skips invalidation when revalidateOptimisticData is false', () => {
    const setQueryData = vi.fn()
    const invalidateQueries = vi.fn()
    const queryClient = { setQueryData, invalidateQueries } as any

    const onInvalidate = createTanStackAdapter(queryClient, { revalidateOptimisticData: false })
    onInvalidate({ target: 'tanstack-query', queryKey: ['todos'], optimisticData: { id: 1 } })

    expect(setQueryData).toHaveBeenCalledWith(['todos'], { id: 1 })
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('SWR: calls mutate with revalidate matching revalidateOptimisticData', () => {
    const mutate = vi.fn()

    const onInvalidateTrusted = useSwrAdapter(mutate, { revalidateOptimisticData: false })
    onInvalidateTrusted({ target: 'swr', key: ['todos'], optimisticData: { id: 1 } })
    expect(mutate).toHaveBeenLastCalledWith(['todos'], { id: 1 }, { revalidate: false })

    const onInvalidateDefault = useSwrAdapter(mutate)
    onInvalidateDefault({ target: 'swr', key: ['todos'], optimisticData: { id: 1 } })
    expect(mutate).toHaveBeenLastCalledWith(['todos'], { id: 1 }, { revalidate: true })
  })

  it('signals without optimisticData fall back to existing invalidate-only behavior unchanged', () => {
    const mutate = vi.fn()
    const onInvalidate = useSwrAdapter(mutate)

    onInvalidate({ target: 'swr', key: ['todos'] })

    // No optimisticData present — must not call the data-write path at all
    expect(mutate).not.toHaveBeenCalledWith(['todos'], expect.anything(), expect.anything())
  })
})
```

### 13.5 Coverage this leaves deliberately unaddressed

Per §11 (Non-Goals), there is no test for "a client cannot get another user's data by manipulating `clientContext` values it's otherwise allowed to send" — that boundary is an application-level authorization decision this library cannot verify generically, so no generic test can meaningfully assert it. The tests above cover the boundary the library *does* own: that `clientContext`'s type and runtime shape are constrained to what the developer explicitly declared, and that scope-pinning rejects a `connectionId` update from a caller whose `meta` doesn't match.
