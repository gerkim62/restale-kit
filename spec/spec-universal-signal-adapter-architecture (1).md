# Spec: Universal Signal + Adapter Architecture

**Package:** restale-kit  
**Area:** `types/protocol.ts`, `utils/constants.ts`, `server/core/channel.ts`, `server/core/channel-group.ts`, `server/core/framing.ts`, `server/transport-utils.ts`, `client/core/sse-client.ts`, `client/core/client-contracts.ts`, `client/react/useReStale.ts`, `client/swr/`, `client/tanstack-query/`, `client/rtk-query/`  
**Status:** Proposed  
**Breaking changes:** Yes — intentional and accepted  

---

## 1. Motivation

The current design puts the server in the position of knowing the internal vocabulary of every client-side caching library it might talk to. Adding RTK Query required touching `protocol.ts`, `constants.ts`, `channel.ts`, and all related test files. Every new library requires the same surgery. The server must be configured with a `target`, the client must send `__restale_target__` as a query param, and the type system must maintain a permutation table (`SignalPermutations`, `CompleteBatchForTargets`) that is nearly impossible to read and grows combinatorially with each new target.

The root cause: the server speaks in library-native signals. The fix: the server speaks one universal language, and **client adapters translate**.

This change also eliminates the class of bugs where a developer configures mismatched targets between server and client, and eliminates the `unsupported-target` revocation path entirely.

---

## 2. Core Idea

```
{revalidate} | {inlineData}
```

The server emits one of two signal shapes. The client adapter — owned by the developer, or provided by the library for SWR and TanStack Query — translates that signal into whatever the library needs. The server has no knowledge of, and no dependency on, any client library.

---

## 3. Signal Type

### 3.1 The Universal Signal

```ts
/**
 * A cache key. Must survive a JSON.stringify → JSON.parse round-trip losslessly.
 * Always an array — adapters convert to library-native key shapes internally.
 */
export type CacheKey = JSONValue[]

/**
 * Tells the client to revalidate (re-fetch) entries matching this key.
 */
export interface RevalidateSignal {
  readonly key: CacheKey
  /**
   * When true, only entries whose key matches exactly are revalidated.
   * When false (default), all entries whose key starts with this key are revalidated
   * (prefix/hierarchical match). Adapters MUST honour this — it is a contract, not a hint.
   */
  readonly exact?: boolean
}

/**
 * Tells the client to write data directly into the cache at this exact key,
 * then optionally mark it stale so a background refetch occurs.
 *
 * `key` must identify a single cache entry — prefix matching does not apply
 * to inline data writes. There is no `exact` field; writes are always exact.
 *
 * `markStale` defaults to false. The server pushed this data intentionally;
 * absent an explicit instruction to re-fetch, adapters treat it as authoritative.
 * Set `markStale: true` only when the pushed data is speculative/optimistic and
 * the client should re-validate in the background.
 */
export interface InlineDataSignal {
  readonly key: CacheKey
  readonly inlineData: JSONValue
  readonly markStale?: boolean
}

/**
 * The complete wire signal. A discriminated union of the two possible server intents.
 * Discriminated on the presence of `inlineData`.
 *
 * This is the only signal type that crosses the wire. There is no `target` field.
 * There is no library-specific vocabulary. Adapters receive this and translate.
 */
export type UniversalSignal = RevalidateSignal | InlineDataSignal

/**
 * Type guard. Narrows a UniversalSignal to InlineDataSignal.
 * Adapters use this to branch between the two handling paths.
 */
export function isInlineDataSignal(signal: UniversalSignal): signal is InlineDataSignal {
  return 'inlineData' in signal
}
```

### 3.2 What is removed from `protocol.ts`

The following are deleted entirely. No migration shim. No deprecation period.

- `TanStackQuerySignal`
- `SWRSignal`
- `RTKQuerySignal`
- `GenericInvalidateSignal`
- `BaseInvalidateSignal`
- `SignalTarget` and `SIGNAL_TARGETS`
- `TanStackQueryAction`, `TANSTACK_QUERY_ACTIONS`
- `SWRAction`, `SWR_ACTIONS`
- `GenericAction`, `GENERIC_ACTIONS`
- `ReStaleSignalForTarget<T>`
- `TargetForSignal<T>`
- `ExplicitSignalForTarget<T>`
- `OptionalTargetSignal<T>`
- `Permutations2<A, B>`
- `Permutations3<A, B, C>`
- `SignalPermutations<T>` (the recursive one)
- `CompleteBatchForTargets<T>`
- `SignalInputForTarget<T>`
- `matchesInvalidateSignalKey` — deleted. Adapters no longer do key matching; they receive the exact key and pass it to the library's native API. The library does matching.
- `InvalidateSignal` alias — replaced by `UniversalSignal`

### 3.3 What `ReStaleSignal` becomes

```ts
/** Canonical alias. The type of signal that crosses the wire. */
export type ReStaleSignal = UniversalSignal
```

### 3.4 Type constraints that TS must enforce

These must be caught at compile time. None of them are "nice to have". If TypeScript cannot enforce them structurally, use branded types or conditional types to make it so.

**a) `inlineData` without `key` is a type error.**  
`InlineDataSignal` always requires `key`. This is structurally enforced by the type definition — there is no `{ inlineData: JSONValue }` without `key: CacheKey`.

**b) `exact: false` on an `InlineDataSignal` is a type error.**  
Inline data writes are always exact — prefix matching on a cache write is undefined behaviour. `InlineDataSignal` does not have an `exact` field, so `exact: false` is rejected structurally. `exact: true` is also rejected by the same structural rule, but the dangerous value is `false`: it implies prefix matching, which has no coherent meaning for a write.

**c) `markStale` on a `RevalidateSignal` is a type error.**  
`RevalidateSignal` does not have a `markStale` field. TS rejects it structurally.

**d) `key` must be `JSONValue[]`, not `string`, not `any[]`, not `unknown[]`.**  
`CacheKey = JSONValue[]` enforces this. The existing `isJSONValue` and `isJSONValueArray` guards remain for runtime validation.

**e) `markStale` only accepts `boolean`, not `boolean | undefined` explicitly — it is optional, defaulting to `false` when absent.**  
`readonly markStale?: boolean` — TypeScript correctly types absent as `undefined`, and downstream code should treat absent as `false`.

**f) Batch signals are typed as `UniversalSignal[]`, not `(RevalidateSignal | InlineDataSignal)[]` with mixed required fields.**  
The array type is `UniversalSignal[]`. Any element may be either arm. There is no requirement that a batch be homogeneous.

---

## 4. Constants and Headers

### 4.1 Removed from `constants.ts`

```ts
// REMOVED entirely:
SIGNAL_TARGETS                           // no targets in the new model
SSE_RESPONSE_HEADERS                     // entire object gone — X-ReStale-Target and X-ReStale-Supported no longer sent; the server has nothing to advertise
PROTOCOL_CONSTANTS.RESTALE_TARGET_PARAM  // __restale_target__ query param gone
```

### 4.2 What stays

```ts
PROTOCOL_CONSTANTS.RESTALE_REQUEST_ID_PARAM  // __restale_cid__ stays — connection identity is still needed
PROTOCOL_CONSTANTS.LAST_EVENT_ID_HEADER      // stays — replay still needs it
SSE_HEADERS                                  // Content-Type, Cache-Control, Connection — unchanged
SSE_EVENTS                                   // invalidate, revoke, keepalive, renew, retriesexhausted — unchanged
```

---

## 5. Server Changes

### 5.1 `SSEChannelOptions`

Removed fields:
- `target` — gone entirely
- `requestedTarget` — gone entirely

`createSSEChannel` no longer accepts or requires `target`. The `DirectSSEChannelOptions` type that required it is deleted. `SSEChannelOptions` is simplified:

```ts
export interface SSEChannelOptions {
  keepaliveIntervalMs?: number
  retryIntervalMs?: number
  lastEventId?: string
  eventStore?: EventStore
  eventBufferCapacity?: number
  idGenerator?: () => string
  connectionId?: string
  lifetime?: LifetimeOptions
  beforeFrame?: BeforeFrameFn
  guardKeepalive?: boolean
}
```

### 5.2 `SSEChannel` interface

Removed fields:
- `readonly target` — gone
- `readonly requestedTarget` — gone

`invalidate(signal: UniversalSignal | UniversalSignal[], customId?: string): string`  
The parameter type is now `UniversalSignal | UniversalSignal[]`. The method no longer does target filtering — it sends what it receives.

### 5.3 `validateTargetConfiguration` — deleted

This function validated that configured targets were in the known set and non-duplicate. With no targets, it has nothing to do. Delete it.

### 5.4 `validateSignalTargets` — deleted

This function filtered signals to only those matching the configured target and the client's requested target. With no targets, signal routing is unconditional. Delete it.

### 5.5 `channel.ts` — target validation block

The entire block in the stream-open path that:
1. Reads `requestedTarget`
2. Checks it against `supportedTargets`
3. Sends a `formatRevokeFrame('unsupported-target', ...)` and closes

This block is deleted. There is no target negotiation. Any client connecting to any channel gets the same universal signals.

### 5.6 `channel.ts` — replay filtering

The replay path currently filters stored signals by `requestedTarget`. That filter is removed. Replayed signals are delivered as-is, same as live signals.

### 5.7 `FrameGuardCtx`

`requestedTarget` is removed from `FrameGuardCtxBase`. Any `beforeFrame` callback that reads `ctx.requestedTarget` is a compile error after this change.

```ts
interface FrameGuardCtxBase {
  readonly connectionId: string
  readonly isResume: boolean
  // requestedTarget: gone
}
```

### 5.8 `channel-group.ts`

- `ChannelSetupOptions`: `target` field removed
- `channelDefaults.target`: removed
- The `SignalPermutations`-based type for multi-target batching: deleted
- `invalidate()` and `publish()` on the group: parameter type is `UniversalSignal | UniversalSignal[]`
- `broadcastRaw` and `deliverToChannel`: unchanged — they operate at the channel level and don't care about signal shape

### 5.9 `transport-utils.ts`

- `extractRequestedTarget` — deleted  
- `buildSSETargetHeaders` — deleted  
- Transport adapters (`fetch/response.ts`, `node/attach.ts`, `express/`, `fastify/`, `hono/`) no longer call either function and no longer attach `X-ReStale-Target` or `X-ReStale-Supported` headers

### 5.10 `RevokeEventDetail`

The `'unsupported-target'` discriminant is removed:

```ts
// BEFORE — has 'unsupported-target' arm with requested/supported fields
// AFTER:
export type RevokeEventDetail = {
  reason?:
    | 'deadline'
    | 'session-expired'
    | 'logout'
    | 'banned'
    | 'unauthorized'
    | 'custom'
    | (string & {})
}
```

The `requested` and `supported` fields disappear with it.

### 5.11 `framing.ts`

`formatRevokeFrame` loses its `'unsupported-target'` overload:

```ts
// Only one signature remains:
export function formatRevokeFrame(reason?: string): Uint8Array
```

---

## 6. Client Changes

### 6.1 `ClientOptions`

Removed fields:
- `target` — gone. There is nothing to negotiate with the server.

```ts
export interface ClientOptions {
  autoReconnect?: boolean | AutoReconnectOptions
  reconnect?: ReconnectOptions
  withCredentials?: boolean
  debug?: boolean
  clientContextUrl?: string
  callback?: AdaptedCallback | ((signal: UniversalSignal | UniversalSignal[]) => void)
  onConnect?: (event: Event) => void
  onDisconnect?: (event: Event) => void
  onError?: (error: unknown) => void
}
```

### 6.2 `SSEInvalidatorClient`

- The `__restale_target__` query param is no longer appended to the EventSource URL
- `TSignal` generic parameter is removed — the client always deals in `UniversalSignal`
- `SSEInvalidatorClientEventMap` is updated: `invalidate` event detail is `UniversalSignal | UniversalSignal[]`

### 6.3 `AdaptedCallback`

The phantom brand no longer tracks `TTarget` since there is no target. The brand serves two purposes: it distinguishes a callback produced by a library adapter factory from a raw user function (useful for documentation, tooling, and future structural extension), and it reserves the property slot if metadata needs to be attached later without a breaking change. It carries no information beyond its presence.

```ts
/**
 * A callback branded to indicate it was produced by an adapter factory.
 * The brand is a compile-time marker only — it has no runtime representation
 * beyond the boolean property on the function object.
 * Pass this to `useReStale` or `SSEInvalidatorClient` as `callback`.
 */
export type AdaptedCallback = ((signal: UniversalSignal | UniversalSignal[]) => void) & {
  readonly __restaleAdapter: true
}

export function makeAdaptedCallback(
  fn: (signal: UniversalSignal | UniversalSignal[]) => void
): AdaptedCallback {
  return Object.assign(fn, { __restaleAdapter: true as const })
}
```

### 6.4 `useReStale` options

Removed fields:
- `target` — gone
- The `NoInfer<TTarget>` constraint — gone with it
- `TTarget` and `TSignal` type parameters — gone

```ts
export interface UseReStaleOptions extends ClientOptions {
  disabled?: boolean
  onInvalidate: AdaptedCallback | ((signal: UniversalSignal | UniversalSignal[]) => void)
  onRevoke?: (detail: RevokeEventDetail) => void
  onRejected?: (response: RejectedConnectionResponse) => void
  onRetriesExhausted?: (detail: { attempts: number; maxRetries: number }) => void
  clientContext?: unknown
  clientContextSync?: {
    maxAttempts?: number
    retryDelayMs?: number
    onExhausted?: 'retryOnNextChange' | 'disableUntilReconnect'
  }
}
```

The type system no longer needs to infer `TTarget` from the adapter callback and check it against an explicit `target`. That entire machinery is gone. `useReStale` accepts any `onInvalidate` callback that handles `UniversalSignal | UniversalSignal[]`.

---

## 7. Adapter Interface

### 7.1 Contract

An adapter is a function that takes a `UniversalSignal | UniversalSignal[]` and performs the appropriate cache operation for its library. It is produced by calling `makeAdaptedCallback(fn)` so it carries the `__restaleAdapter` brand.

Adapters MUST:
- Handle both single signals and arrays
- Honour `exact: true` vs absent/false as a strict contract (see §3.4)
- Treat absent `markStale` as `false` (authoritative data, no refetch)
- Use `isInlineDataSignal(signal)` to branch between the two handling paths
- Convert `CacheKey` (always `JSONValue[]`) to the library's native key format internally

Adapters MUST NOT:
- Inspect or act on any field not defined on `UniversalSignal`
- Silently swallow errors from library calls — surface them or let them propagate
- Add adapter-level configuration that re-implements what the signal already expresses (e.g. a global `markStale` override that ignores the signal's own `markStale` field)

### 7.2 Key conversion contract

`CacheKey` is `JSONValue[]`. Libraries have different native key types:

- **TanStack Query**: `QueryKey = unknown[]` — pass `signal.key` directly as `queryKey`; the `toQueryKey` option (§7.3) overrides this when library keys are not `CacheKey` arrays
- **SWR**: `Key = string | any[]` — for string-keyed SWR usage, the adapter must accept a `toKey` option that maps `CacheKey` to the SWR key (e.g. `(key) => key[0] as string`); if omitted, `signal.key` is used directly as a tuple key
- **Custom adapters**: the adapter author is responsible for the mapping

### 7.3 TanStack Query adapter

```ts
export interface TanstackQueryAdapterOptions {
  /**
   * Maps a CacheKey to a TanStack QueryKey if the library's keys are not already CacheKey arrays.
   * When omitted, signal.key is used directly as QueryKey.
   */
  toQueryKey?: (key: CacheKey) => QueryKey
}

export function tanstackQueryAdapter(
  queryClient: QueryClientLike,
  options?: TanstackQueryAdapterOptions
): AdaptedCallback

export function useTanstackQueryAdapter(
  queryClient: QueryClientLike,
  options?: TanstackQueryAdapterOptions
): AdaptedCallback
```

**Behavior:**

For `InlineDataSignal`:
1. Call `queryClient.setQueryData(queryKey, signal.inlineData)`
2. If `signal.markStale === true`: call `queryClient.invalidateQueries({ queryKey, exact: true })`
3. Step 2 uses `exact: true` unconditionally — inline data is always written to a specific entry, so the follow-up stale mark must also be exact

For `RevalidateSignal`:
1. Call `queryClient.invalidateQueries({ queryKey, exact: signal.exact })`  
   Pass `signal.exact` directly — do not default to `false` when absent. Absent means "use the library's default," which is currently `false` in TanStack Query but is their contract to keep, not ours to override. Pinning to `false` would silently suppress any future change to TanStack's default behavior.

No `action` field. No `type` filter. No `stale` field. No `reset`/`cancel`/`remove` from the server. If a developer needs those operations they do them in their own application code, triggered by application events — not via the SSE channel.

### 7.4 SWR adapter

```ts
export interface SWRAdapterOptions {
  /**
   * Maps a CacheKey to a SWR key.
   * When omitted, signal.key is used directly as the SWR key (array form).
   */
  toKey?: (key: CacheKey) => SWRKey
}

export function swrAdapter(
  mutate: SWRMutator,
  options?: SWRAdapterOptions
): AdaptedCallback

export function useSwrAdapter(
  mutate: SWRMutator,
  options?: SWRAdapterOptions
): AdaptedCallback
```

**Behavior:**

For `InlineDataSignal`:
1. Call `mutate(swrKey, signal.inlineData, { revalidate: false })`
2. If `signal.markStale === true`: call `mutate(swrKey)` (bare revalidate, exact key)
3. Step 2 uses the exact key form, never the matcher-function form — same reasoning as TanStack

For `RevalidateSignal`:
- If `signal.exact === true`: call `mutate(matcher)` where matcher checks for exact key equality
- If `signal.exact` is absent or `false`: call `mutate(matcher)` where matcher checks for prefix match

The `SWRMutator` interface is updated to reflect actual needed overloads only. No overloads added beyond what the adapter uses.

### 7.5 RTK Query

**Dropped.** RTK Query's tag-based invalidation model (`invalidateTags(['Post', { type: 'Post', id: 5 }])`) has no direct mapping from a `CacheKey`. A `keyToTags` mapper would be required, making it a second-class adapter that happens to ship with the library. It should be a community adapter. The `client/rtk-query/` directory and the `RTKQuerySignal` type are deleted.

---

## 8. `PubSubMessage`

The `inlineData` kind on `PubSubMessage` (from the client-context spec) is unchanged. The `signal` kind's `data` type is updated:

```ts
export type PubSubMessage =
  | { kind: 'signal'; data: UniversalSignal | UniversalSignal[]; id?: string }
  | { kind: 'control'; data: JSONValue }
  | { kind: 'inlineData'; topic: string; payload: JSONValue }
```

---

## 9. `EventRecord` and `EventStore`

The generic parameter `TSignal` is removed. These types now operate on `UniversalSignal` directly:

```ts
export interface EventRecord {
  id: string
  signal: UniversalSignal | UniversalSignal[]
}

export interface EventStoreResult {
  events: EventRecord[]
  stale: boolean
}

export interface EventStore {
  readonly add: (signal: UniversalSignal | UniversalSignal[], customId?: string) => EventRecord
  readonly getEventsAfter: (lastEventId: string) => EventStoreResult
  readonly clear: () => void
}
```

---

## 10. Type System Invariants — Full Enumeration

This section is the authoritative list of what the type system must enforce. Implementation must not skip any item. If TypeScript cannot enforce something structurally, use a conditional type or branded type to make it so — do not document it as "enforced by convention."

| # | Invariant | Mechanism |
|---|-----------|-----------|
| 1 | `InlineDataSignal` requires `key` | Structural — `key` is not optional on `InlineDataSignal` |
| 2 | `InlineDataSignal` rejects `exact` (both `true` and `false`) | Structural — `exact` is not a field on `InlineDataSignal`; the dangerous value is `false` (implies prefix matching on a write, which is undefined); `true` is equally rejected by the same structural rule |
| 3 | `RevalidateSignal` rejects `markStale` | Structural — `markStale` is not a field on `RevalidateSignal` |
| 4 | `RevalidateSignal` rejects `inlineData` | Structural — `inlineData` is not a field on `RevalidateSignal` |
| 5 | `key` must be `JSONValue[]` | `CacheKey = JSONValue[]` — `string[]`, `any[]`, `unknown[]` are rejected |
| 6 | `inlineData` must be `JSONValue` | Structural — `Date`, `Map`, `Set`, functions, class instances are rejected |
| 7 | `markStale` only accepts `boolean` | `readonly markStale?: boolean` — string, number, etc. rejected |
| 8 | Any callback passed as `onInvalidate` or `callback` must accept `UniversalSignal \| UniversalSignal[]` | Enforced at the point of creation by `makeAdaptedCallback`'s input type; `useReStale` and `ClientOptions` accept `AdaptedCallback \| ((signal: UniversalSignal \| UniversalSignal[]) => void)` — narrower signatures are rejected |
| 9 | `exact` only accepts `boolean` | `readonly exact?: boolean` |
| 10 | `NaN`, `Infinity`, `-Infinity` are rejected from `key` | `JSONValue` excludes non-finite numbers via `isJSONValue` runtime guard; the type itself cannot block these at compile time — runtime validation is required and must be tested |
| 11 | A batch must be `UniversalSignal[]` — mixing arms is allowed, mixing with non-`UniversalSignal` values is not | `UniversalSignal[]` structural check |

**TypeScript compiler options note:**  
Structural rejection of fields absent from an interface (invariants 2, 3, 4) works in strict mode via excess property checking on object literals — `exactOptionalPropertyTypes` is not required for those cases. Where `exactOptionalPropertyTypes: true` *does* matter is the edge case of explicitly assigning `undefined` to an optional field: without it, `{ key: [...], inlineData: x, exact: undefined }` is accepted as equivalent to absent, meaning a caller could pass `exact: undefined` on an `InlineDataSignal` without a compile error. With the flag set, that is rejected. `exactOptionalPropertyTypes: true` must be set in `tsconfig.json`.

---

## 11. What Does NOT Change

- `channel.ts` — `invalidate()` method signature simplifies but the stream/close/keepalive/revoke/renew lifecycle is unchanged
- `EventSource` SSE wire format — still `event: invalidate\ndata: {...}\n\n`
- `connectionId` / `__restale_cid__` — still required, still generated client-side
- `last-event-id` replay — unchanged
- `keepalive` frames — unchanged
- `revoke` frames — unchanged (the `unsupported-target` arm is deleted; the remaining reasons are unchanged)
- `renew` frames — unchanged
- `Frame Guard` (`beforeFrame`, `LifetimeOptions`, `OnDeadline`) — unchanged; `requestedTarget` is removed from `FrameGuardCtxBase` per §5.7
- `EventStore` — logic unchanged, generic parameter removed (§9)
- `PubSubAdapter` interface — unchanged, `PubSubMessage` signal kind updated (§8)
- `pubsub/ably`, `pubsub/pusher`, `pubsub/redis` — no changes needed beyond the `PubSubMessage` type update
- `clientContext` / `pushInlineData` / `resolveInlineData` — unchanged (from the client-context spec)
- `revokeByConnectionId`, `revokeWhere` — unchanged
- `createEventStore` — unchanged
- `SSE_EVENTS` constants — unchanged

---

## 12. Testing Strategy

### 12.1 Load-bearing test rules

Same rules as the existing codebase:

- Every `@ts-expect-error` needs a passing sibling immediately adjacent — an isolated negative test only proves *something* errors, not that the *right* thing does
- Use `expectTypeOf(x).toEqualTypeOf<T>()` not `toMatchTypeOf` — assignability checks pass for wider/narrower types
- No `any` in a type test — construct values structurally or via `{} as ExactType`
- Runtime tests assert on observable state, not call counts alone

### 12.2 Type-level tests (`*.test-d.ts`)

**Signal shape:**
- `{ key: ['todos'] }` satisfies `RevalidateSignal` ✓
- `{ key: ['todos'], exact: true }` satisfies `RevalidateSignal` ✓
- `{ key: ['todos'], inlineData: { id: 1 } }` satisfies `InlineDataSignal` ✓
- `{ key: ['todos'], inlineData: { id: 1 }, markStale: true }` satisfies `InlineDataSignal` ✓
- `{ key: ['todos'], exact: false, inlineData: { id: 1 } }` — `@ts-expect-error` (no `exact` on `InlineDataSignal`; `false` is the dangerous value — implies prefix matching on a write), adjacent passing case omits `exact`
- `{ key: ['todos'], exact: true, inlineData: { id: 1 } }` — `@ts-expect-error` (equally rejected by the same structural rule), adjacent passing case omits `exact`
- `{ key: ['todos'], markStale: true }` — `@ts-expect-error` (no `markStale` on `RevalidateSignal`), adjacent passing case is `InlineDataSignal`
- `{ inlineData: { id: 1 } }` — `@ts-expect-error` (missing `key`), adjacent passing case adds `key`
- `{ key: 'todos' }` — `@ts-expect-error` (`key` must be array), adjacent passing case uses `['todos']`
- `{ key: [() => {}] }` — `@ts-expect-error` (function not in `JSONValue`)
- `{ key: ['todos'], inlineData: new Date() }` — `@ts-expect-error` (`Date` not in `JSONValue`)
- `{ key: ['todos'], inlineData: { id: 1 }, markStale: 'yes' }` — `@ts-expect-error` (`markStale` must be `boolean` on `InlineDataSignal`), adjacent passing case uses `markStale: true`
- `UniversalSignal[]` accepts `[revalidateSignal, inlineDataSignal]` — mixed batch is valid ✓

**Adapter:**
- `useTanstackQueryAdapter(queryClient)` returns `AdaptedCallback` ✓
- `useSwrAdapter(mutate)` returns `AdaptedCallback` ✓
- `makeAdaptedCallback((s) => {})` returns `AdaptedCallback` ✓
- `useReStale('/sse', { onInvalidate: adaptedCallback })` — no type error ✓
- `useReStale('/sse', { onInvalidate: (s: UniversalSignal | UniversalSignal[]) => {} })` — no type error ✓
- `useReStale('/sse', { onInvalidate: adaptedCallback, target: 'swr' })` — `@ts-expect-error` (`target` no longer exists on `UseReStaleOptions`), adjacent passing case omits `target`
- `ClientOptions` does not have a `target` field — `@ts-expect-error` on any attempt to pass it
- `RevokeEventDetail` does not have a `reason: 'unsupported-target'` arm — `@ts-expect-error` on narrowing to it

**`isInlineDataSignal` narrows correctly:**
- After `if (isInlineDataSignal(s))`: `s` is `InlineDataSignal`, `s.inlineData` is `JSONValue` ✓
- In the else branch: `s` is `RevalidateSignal`, `s.inlineData` — `@ts-expect-error` (field doesn't exist)

### 12.3 Runtime tests — signal handling

**Channel (`channel.test.ts`):**
- `invalidate({ key: ['todos'] })` enqueues an `invalidate` SSE frame; parsing the frame gives back `{ key: ['todos'] }` with no `target` field
- `invalidate({ key: ['todos'], inlineData: { id: 1 } })` enqueues correctly; parsed frame has `inlineData`
- Batch `invalidate([{ key: ['a'] }, { key: ['b'], inlineData: 1 }])` enqueues a single frame with an array payload
- No `__restale_target__` in the connection URL for any test case
- No `X-ReStale-Target` or `X-ReStale-Supported` header in any response

**Channel group (`channel-group.test.ts`):**
- `group.invalidate({ key: ['todos'] })` delivers to all registered channels
- There is no `target` option on `createFetchResponse` or `attachNodeResponse`; passing one is a type error (covered in §12.2 type tests)

### 12.4 Runtime tests — adapters

**TanStack Query (`tanstack-query/adapter.test.ts`):**
- `RevalidateSignal` with `exact` absent calls `invalidateQueries({ queryKey: signal.key, exact: undefined })` — not `false`; absent means defer to TanStack's default
- `RevalidateSignal` with `exact: false` calls `invalidateQueries({ queryKey: signal.key, exact: false })`
- `RevalidateSignal` with `exact: true` calls `invalidateQueries({ queryKey: signal.key, exact: true })`
- `InlineDataSignal` with `markStale` absent or `false` calls `setQueryData(signal.key, signal.inlineData)` and does NOT call `invalidateQueries`
- `InlineDataSignal` with `markStale: true` calls `setQueryData` then `invalidateQueries({ queryKey: signal.key, exact: true })`
- The follow-up `invalidateQueries` on `markStale: true` is always `exact: true` regardless of any other signal field — assert this explicitly
- A batch `[revalidate, inlineData]` processes both entries in order
- `toQueryKey` option, when provided, is called with `signal.key` and its return value is used as `queryKey`

**SWR (`swr/adapter.test.ts`):**
- `RevalidateSignal` with `exact` absent/false: matcher-function form, matches prefix
- `RevalidateSignal` with `exact: true`: matcher-function form, matches exact only
- `InlineDataSignal` with `markStale` absent/false: `mutate(key, data, { revalidate: false })` only
- `InlineDataSignal` with `markStale: true`: above plus bare `mutate(key)` in exact form (not matcher-function form)
- **Regression:** a `RevalidateSignal` with `exact: false` and `key: ['posts']` does NOT write inline data to `['posts', 1]` — separate entries are not touched by a revalidate (obvious but must be tested)
- **Regression:** an `InlineDataSignal` to `['posts', 1]` does NOT mark `['posts', 2]` stale, even when `markStale: true`

### 12.5 Tests that are deleted

The following test files and test cases are deleted outright. No replacement is required.

- All `adapter.test-d.ts` cases asserting `target` inference from adapter brand
- All `channel.test-d.ts` cases for `SignalInputForTarget`, `CompleteBatchForTargets`, `SignalPermutations`
- All `channel.test.ts` cases for `unsupported-target` revocation
- All `channel.test.ts` cases for `requestedTarget` filtering
- All `protocol.test-d.ts` cases for `TanStackQuerySignal`, `SWRSignal`, `RTKQuerySignal`, target discriminants
- `client/rtk-query/adapter.test.ts` — entire file
- `useReStale.test-d.ts` cases for `target` inference / mismatch errors
- Any test asserting `X-ReStale-Target` or `X-ReStale-Supported` headers
- Any test asserting `__restale_target__` in the SSE connection URL

---

## 13. Non-Goals

- No library-level support for RTK Query tag-based invalidation. See §7.5.
- No `action` field on the universal signal. `cancel`, `reset`, `remove`, `purge` are not server concerns. Application code handles them.
- No `type` filter (active/inactive/all) on the universal signal. This is a TanStack Query-specific concept. If needed, the TanStack adapter can expose it as adapter configuration keyed to specific cache keys — it is not part of the protocol.
- No server-side key derivation or key aliasing. The server emits the key it knows about. Adapters map it to library keys.
- No adapter-level `markStale` override that ignores the signal's `markStale`. The signal is authoritative. Adapters do not get a veto.
