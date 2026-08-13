# Documentation Audit Report

This is a corrected, evidence-based audit of the documentation against the public entry points and implementation in `restale-kit/src/`.

**Audit date:** 2026-08-12

**Scope:** `docs/`, the package export map, source interfaces, and focused tests.
**Finding rule:** A finding below is either a demonstrably incorrect statement/example or a public API omission from `docs/api-reference.md`, which claims to be the “Complete export surface.” General requests for more tutorials or defensive-programming advice are intentionally excluded.

## High-impact correctness issues

### 1. Wire frames retain `target`; two guides say it is stripped

**Locations:** `docs/api-reference.md` (“Target & Wire Framing Behavior”) and `docs/server.md` (“Target Signal Requirements & Wire Optimization”).

Both pages say that outgoing SSE `invalidate` frames strip `target` and show payloads such as `{"key":["todos"]}`. This is false. `formatInvalidateFrame()` serializes the signal unchanged, and the target round-trip tests require the discriminator to be present so the client can validate target-specific shapes.

For example, an SWR frame contains `{"target":"swr","key":["todos"]}`, and a TanStack Query frame contains `{"target":"tanstack-query","queryKey":["todos"]}`.

**Fix:** Replace the “wire optimization” claims with: “Signals retain their `target` discriminator on the wire. `X-ReStale-Target` communicates the negotiated connection target; it does not replace the signal discriminator.”

### 2. The API reference names a nonexistent `SIGNAL_TARGETS.TANSTACK`

**Location:** `docs/api-reference.md` core types.

The documented constant has `TANSTACK: 'tanstack-query'`, while the implementation exports `TANSTACK_QUERY`. The same page later uses `SIGNAL_TARGETS.TANSTACK_QUERY`, making its own example inconsistent and non-compilable.

**Fix:** Rename the documented property to `TANSTACK_QUERY`.

### 3. The API reference documents a nonexistent client context API

**Location:** `docs/api-reference.md`, `ClientOptions` and `UseReStaleResult`.

`clientContext` and `updateClientContext()` are not implemented or exported. A repository-wide search finds no such client feature.

**Fix:** Remove both entries. Do not replace them with an invented transport mechanism.

### 4. The client API reference omits real options, status variants, and events

**Location:** `docs/api-reference.md`, `restale-kit/client` section.

The documented API leaves out public functionality that consumers need to handle:

- `ClientOptions` is missing `debug`, `callback`, `onConnect`, `onDisconnect`, and `onError`.
- `ReconnectOptions` is missing `nonRetryableStatuses` and `retryAfter`; `HttpStatusMatcher` is also undocumented.
- `ConnectionStatus` is missing `{ status: 'closed'; reason: 'rejected'; response: RejectedConnectionResponse }`.
- `RejectedConnectionResponse`, `RenewEventDetail`, and `AdaptedInvalidateCallback` are public client exports but are absent from the import/type coverage.
- `SSEInvalidatorClientEventMap` omits the public `rejected`, `renew`, and `retriesexhausted` events.

**Fix:** Document the exported definitions from `client/core/client-contracts.ts` without weakening their types. In particular, `RejectedConnectionResponse.headers` is `Readonly<Record<string, readonly string[]>>`.

### 5. `AutoReconnectOptions` is presented as public even though it cannot be imported

**Location:** `docs/api-reference.md`, `restale-kit/client` section.

The page gives `AutoReconnectOptions` a public interface definition, but `restale-kit/client` does not re-export that type. It is therefore not part of the documented entry point’s named export surface.

**Fix:** Either export `AutoReconnectOptions` from `restale-kit/client`, or document the object form inline as `boolean | { native?: boolean; jsBackoff?: boolean }` and avoid presenting it as an importable public type.

### 6. The React API reference substantially understates the hook contract

**Location:** `docs/api-reference.md`, `restale-kit/react` section.

`UseReStaleOptions` omits the supported `onRejected` and `onRetriesExhausted` callbacks. `UseReStaleResult` omits `attempt`, `isConnecting`, `isReconnecting`, `isClosed`, and `isError` (not merely the first four listed in the previous report).

**Fix:** Align the reference with `UseReStaleOptions` and `UseReStaleResult` in `src/client/react/useReStale.ts`, while removing the nonexistent `updateClientContext()` entry from issue 3.

### 7. The TanStack Query reference invents an options parameter and type

**Location:** `docs/api-reference.md`, `restale-kit/tanstack-query` section.

The documentation gives both `tanstackQueryAdapter` and `useTanstackQueryAdapter` an `options?: TanStackQueryAdapterOptions` parameter. Neither the parameter nor `TanStackQueryAdapterOptions` exists. The real functions take only `queryClient: QueryClientLike` and return an `AdaptedInvalidateCallback<'tanstack-query', TSignal>`.

**Fix:** Remove the options parameter and document the public `QueryClientLike` structural interface instead of importing `QueryClient` as the required parameter type.

### 8. RTK Query is a public subpath but is undocumented

**Locations:** `docs/api-reference.md` and `docs/client.md`.

`restale-kit/rtk-query` is in the package export map and exports `rtkQueryAdapter`, `useRtkQueryAdapter`, `RTKQuerySignalInput`, and `RTKQueryApiLike`. Neither guide mentions it.

**Fix:** Add an API-reference section and a short client-guide usage example. The adapter delegates to `api.util.invalidateTags(signal.tags)`.

### 9. The server API reference is not a complete export surface

**Location:** `docs/api-reference.md`, `restale-kit/server` section.

The page imports or uses several server types without defining them, and omits several public exports entirely. Important omissions include `createSSEChannel` from the server entry point; `SSEChannel`, `SSEChannelOptions`, `DirectSSEChannelOptions`, `SSEChannelGroupOptions`, `ChannelSetupOptions`; `EventStoreOptions`, `ChannelDefaults`, `mergeChannelDefaults`; and the Fastify request/reply structural types.

The missing `SSEChannel` contract is particularly material: `createFetchResponse()` returns one, but the reference does not describe its `invalidate`, `close`, `disconnect`, `revoke`, or `onClose` methods.

**Fix:** Either make the page a selective guide rather than a “Complete export surface,” or enumerate the actual exports from `src/server/core/index.ts` and define/cross-link each referenced type.

### 10. The testing entry point has the wrong `createSSEChannel` signature

**Location:** `docs/api-reference.md`, `restale-kit/testing` section.

The reference says `createSSEChannel(options: SSEChannelOptions)` can be called with an unconstrained options object. The exported function is the same overloaded `createSSEChannel` used by the server API and requires `target` for a direct channel. The public `DirectSSEChannelOptions` type expresses that requirement.

**Fix:** Show an overload or use `DirectSSEChannelOptions` with required `target` in the testing section.

### 11. The core reference uses inaccessible type names as though they were public exports

**Location:** `docs/api-reference.md`, core types and client/server signatures.

`SignalTarget`, `ReStaleSignalForTarget`, `SignalInputForTarget`, and related helper types are used throughout the displayed signatures, but they are not exported from `restale-kit` and are not imported in the snippets. This makes the purported public API examples impossible to paste into a consumer project as written.

**Fix:** Do not present non-exported implementation helpers as importable public API. Either export them deliberately, or replace them in public examples with importable unions/inline constraints and label them as explanatory pseudotypes.

### 12. The core signal declarations incorrectly require `target`

**Location:** `docs/api-reference.md`, core signal interfaces.

The reference declares `target` as required for `TanStackQuerySignal`, `SWRSignal`, and `RTKQuerySignal`. In the public TypeScript declarations it is optional for all signal shapes; groups and channels attach it when a single configured target makes it redundant for callers.

**Fix:** Change the declarations to `target?: ...` and keep the single-target/multi-target input rules separate from the base signal types.

## Guide and example errors

### 13. The getting-started prose changes a TanStack Query signal into an SWR/generic signal

**Location:** `docs/getting-started.md`, following the React example.

The server example correctly sends `{ queryKey: ['todos'] }` to a `TANSTACK_QUERY` group, but the explanatory sentence says it sends `{ key: ['todos'] }`. A TanStack Query signal requires `queryKey`; `{ key: ... }` is invalid for that target.

**Fix:** Change the prose to `{ queryKey: ['todos'] }`.

### 14. The validation guide documents a nonexistent `optimisticData` field

**Location:** `docs/validation.md`, `SWRSignal` validation rules.

`SWRSignal` has `key`, `action`, `revalidate`, and `match` (plus optional `target`), but no `optimisticData`. The client validator ignores unknown fields, so the current text falsely promises an immediate SWR cache update that never occurs.

**Fix:** Remove the `optimisticData` bullet and its behavior claim.

### 15. The validation guide’s TanStack example sends the wrong signal shape

**Location:** `docs/validation.md`, metadata validation example.

The example creates a group with `target: 'tanstack-query'` but calls `group.broadcast({ key: ['admin-data'] }, ...)`. Normalizing that signal for the configured target produces an invalid TanStack Query payload; it must use `queryKey`.

**Fix:** Change it to `group.broadcast({ queryKey: ['admin-data'] }, ...)`.

### 16. The validation example is missing the `InvalidateSignal` import

**Location:** `docs/validation.md`, metadata validation example.

The example instantiates `new SSEChannelGroup<InvalidateSignal, ClientMeta>(...)` without importing `InvalidateSignal`.

**Fix:** Add `import type { InvalidateSignal } from 'restale-kit'`.

### 17. The pub/sub setup cannot support the revocation example it presents

**Location:** `docs/pubsub.md`, “Setup pattern.”

The SSE route registers channels with `topics` only, so each channel has `undefined` metadata. Later, `logoutUserConnection()` calls `revokeByConnectionId(connectionId, { userId, sessionId })`. Scoped revocation matches the supplied scope against registered metadata; with no metadata, that call will not close the channel.

**Fix:** Register trusted metadata in the route, for example `meta: { userId: req.user.id, sessionId: req.session.id }`, and ensure the actual authentication middleware supplies both fields. Alternatively, remove the scoped-revocation example from that setup.

### 18. The client guide’s full options block omits a documented option form and callback

**Location:** `docs/client.md`, “Full options.”

At the top, `autoReconnect` is documented only as `boolean`, while the same page later documents the supported object form `{ native?: boolean; jsBackoff?: boolean }`. The block also omits `onRetriesExhausted`, even though the React hook supports it.

**Fix:** Make the full options block the canonical contract: show both `autoReconnect` forms and `onRetriesExhausted?: (detail: { attempts: number; maxRetries: number }) => void`.

### 19. The client guide’s return-value block omits exposed state helpers

**Location:** `docs/client.md`, “Return value.”

The hook returns `attempt`, `isConnecting`, `isConnected`, `isReconnecting`, `isClosed`, and `isError`; the guide shows only `connectionId`, `connection`, `reconnect`, and `close`.

**Fix:** Include all returned state helpers, with their status semantics, or link directly to a complete API-reference definition.

### 20. The vanilla client guide does not cover two public terminal lifecycle events

**Location:** `docs/client.md`, vanilla `SSEInvalidatorClient` section.

The guide documents `revoke` and `renew`, but not `rejected` (configured non-retryable HTTP handshake status) or `retriesexhausted` (automatic retry budget exhausted). These are public events and are important alternatives to observing only `statuschange`.

**Fix:** Add concise listeners with the payloads `RejectedConnectionResponse` and `{ attempts, maxRetries }`.

## Removed or corrected claims from the previous report

The prior report was not logically reliable as a whole. The following claims were removed rather than carried forward:

- `closeWithUnmount()` is not nonexistent or hidden: it is a public method on `SSEInvalidatorClient`, is type-tested, and the client guide already labels it for framework-wrapper use.
- `AutoReconnectOptions` is not a missing public export. It exists in implementation but is *not re-exported*; issue 5 states the actual documentation problem.
- `TanStackQueryAdapterOptions` is not a missing type to document. It does not exist; the documented options parameter must be removed.
- The `createEventStore` server-guide example already contains the needed import.
- The client guide already includes the exponential-backoff formula.
- The `register()`/`deregister()` section describes public methods. It may be advanced, but it is not false merely because transport helpers register automatically.
- “Missing error handling,” “missing `await` explanations,” “missing CORS code,” and similar tutorial preferences are not implementation/documentation discrepancies and are out of this audit’s scope.
- Earlier proposed definitions for `ChannelState` and `SSEInvalidateEvent` were inaccurate. `ChannelState` is `'open' | 'closed'`, and `SSEInvalidateEvent` is a signal-or-batch type, not an `{ id, data }` object.

## Summary

**Verified findings:** 20

Priority order:

1. Correct target preservation on the wire, then fix the wrong TanStack signal examples and remove `optimisticData`.
2. Remove invented client APIs and repair the client/react event and option contracts.
3. Bring the API reference in line with the actual server, testing, TanStack Query, and RTK Query public entry points.
