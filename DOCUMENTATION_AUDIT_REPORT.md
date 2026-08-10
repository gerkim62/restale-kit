# Documentation Audit Report

This report identifies all discrepancies between the documentation in `docs/` and the actual implementation/tests in `restale-kit/src/`.

**Audit Date**: 2026-08-10  
**Methodology**: Systematic comparison of documented APIs against source code and tests

---

## Critical Issues

### 1. **API Reference**: Missing `RenewEventDetail` Export (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/client` section

**Issue**: The documentation does NOT list `RenewEventDetail` as an exported type from `restale-kit/client`.

**Evidence**:
- **Implementation**: `restale-kit/src/client/core/index.ts` exports `RenewEventDetail`
- **Tests**: `restale-kit/src/index-exports.test.ts` imports and uses `RenewEventDetail` from the main export
- **Documentation**: Missing from the type export list

**Fix Required**: Add `RenewEventDetail` to the type imports in the `restale-kit/client` section:

```ts
import type { 
  ClientOptions, 
  ReconnectOptions, 
  ConnectionStatus, 
  SSEInvalidatorClientEventMap, 
  RevokeEventDetail,
  RenewEventDetail  // <-- MISSING
} from 'restale-kit/client'
```

---

### 2. **API Reference**: Wrong `SIGNAL_TARGETS` Property Names (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit` core types section

**Issue**: Documentation shows incorrect property names for `SIGNAL_TARGETS` constant.

**Documented (WRONG)**:
```ts
const SIGNAL_TARGETS: {
  readonly TANSTACK: 'tanstack-query'      // ❌ Wrong property name
  readonly SWR: 'swr'                       // ✅ Correct
  readonly RTK: 'rtk-query'                 // ❌ Wrong property name
  readonly GENERIC: 'generic'               // ✅ Correct
}
```

**Actual Implementation** (`restale-kit/src/utils/constants.ts`):
```ts
export const SIGNAL_TARGETS = {
  TANSTACK_QUERY: 'tanstack-query',  // ✅ Correct: underscore, not camelCase
  SWR: 'swr',
  RTK: 'rtk-query',                  // ✅ Correct (RTK is fine, but usage shows this)
  GENERIC: 'generic',
} as const
```

**Evidence**: 
- All implementation files use `SIGNAL_TARGETS.TANSTACK_QUERY`, not `SIGNAL_TARGETS.TANSTACK`
- See: `restale-kit/src/client/tanstack-query/adapter.ts:36`, `restale-kit/src/types/protocol.ts:28`

**Fix Required**: Change `TANSTACK` to `TANSTACK_QUERY` in the documentation.

---

### 3. **API Reference**: Missing `onRejected` Callback (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/react` `UseReStaleOptions` interface

**Issue**: The `UseReStaleOptions` interface in the API reference is missing the `onRejected` callback.

**Evidence**:
- **Documentation (client.md)**: Shows `onRejected?: (response: RejectedConnectionResponse) => void` in the full options list (line 46)
- **API Reference**: Does NOT list `onRejected` in the `UseReStaleOptions` interface

**Fix Required**: Add `onRejected` callback to the `UseReStaleOptions` interface definition:

```ts
interface UseReStaleOptions<TSignal> extends ClientOptions {
  disabled?: boolean
  onInvalidate: (signal: TSignal | TSignal[]) => void
  onRevoke?: (detail: RevokeEventDetail) => void
  onRejected?: (response: RejectedConnectionResponse) => void  // <-- MISSING
}
```

---

### 4. **API Reference**: Missing `RejectedConnectionResponse` Type (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/client` section

**Issue**: `RejectedConnectionResponse` type is NOT listed as an export but is referenced in `ConnectionStatus`.

**Evidence**:
- **Implementation**: Defined in `restale-kit/src/client/core/client-contracts.ts:68-71`
- **Usage**: Referenced in `ConnectionStatus` type and `onRejected` callback
- **Documentation**: Not listed in type exports

**Fix Required**: Add `RejectedConnectionResponse` to the type exports:

```ts
import type { 
  ClientOptions, 
  ReconnectOptions, 
  ConnectionStatus, 
  RejectedConnectionResponse,  // <-- MISSING
  SSEInvalidatorClientEventMap, 
  RevokeEventDetail,
  RenewEventDetail
} from 'restale-kit/client'
```

And define it:

```ts
interface RejectedConnectionResponse {
  status: number
  headers: Readonly<Record<string, readonly string[]>>
}
```

---

### 5. **API Reference**: Missing `rejected` Event (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `SSEInvalidatorClientEventMap` interface

**Issue**: The `rejected` event is NOT documented in the event map.

**Evidence**:
- **Implementation**: `restale-kit/src/client/core/client-contracts.ts:200` defines `rejected: CustomEvent<RejectedConnectionResponse>`
- **Documentation**: Missing from the event map

**Fix Required**: Add the `rejected` event to `SSEInvalidatorClientEventMap`:

```ts
interface SSEInvalidatorClientEventMap<TSignal> {
  invalidate: CustomEvent<TSignal | TSignal[]>
  statuschange: CustomEvent<ConnectionStatus>
  error: CustomEvent<Event>
  rejected: CustomEvent<RejectedConnectionResponse>  // <-- MISSING
  revoke: CustomEvent<RevokeEventDetail>
  renew: CustomEvent<RenewEventDetail>
  retriesexhausted: CustomEvent<{ attempts: number; maxRetries: number }>
}
```

---

### 6. **API Reference**: Missing `renew` and `retriesexhausted` Events (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `SSEInvalidatorClientEventMap` interface

**Issue**: The documentation shows only 3 events (`invalidate`, `statuschange`, `error`, `revoke`) but the implementation has 6 events.

**Missing Events**:
1. `renew: CustomEvent<RenewEventDetail>` 
2. `retriesexhausted: CustomEvent<{ attempts: number; maxRetries: number }>`

**Evidence**:
- **Implementation**: `restale-kit/src/client/core/client-contracts.ts:206-217` defines both events
- **Documentation (client.md)**: Documents the `renew` event with full explanation (lines 275-287)
- **API Reference**: Missing from the event map

**Fix Required**: Add both events to the documented event map.

---

### 7. **API Reference**: Missing `AutoReconnectOptions` Type (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/client` section

**Issue**: `AutoReconnectOptions` interface is NOT documented but is part of the public API.

**Evidence**:
- **Implementation**: Defined in `restale-kit/src/client/core/client-contracts.ts:92-97`
- **Usage**: Used in `ClientOptions.autoReconnect`
- **Documentation**: Not defined in API reference

**Fix Required**: Add the `AutoReconnectOptions` interface definition:

```ts
interface AutoReconnectOptions {
  native?: boolean      // default true (native EventSource auto-reconnect)
  jsBackoff?: boolean   // default true (JS exponential backoff retries)
}
```

---

### 8. **API Reference**: Missing `HttpStatusMatcher` Type (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/client` section

**Issue**: `HttpStatusMatcher` type is NOT documented but is used in `ReconnectOptions`.

**Evidence**:
- **Implementation**: Defined in `restale-kit/src/client/core/client-contracts.ts:73-77`
- **Usage**: Used in `ReconnectOptions.nonRetryableStatuses`
- **Documentation**: Not defined in API reference

**Fix Required**: Add the type definition:

```ts
type HttpStatusMatcher =
  | number
  | '1xx' | '2xx' | '3xx' | '4xx' | '5xx'
  | { from: number; to: number }
```

---

### 9. **API Reference**: Incomplete `ReconnectOptions` (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/client` section

**Issue**: The `ReconnectOptions` interface is missing two properties.

**Documented Properties**:
- `baseDelayMs`
- `maxDelayMs`
- `jitter`
- `maxRetries`

**Missing Properties**:
1. `nonRetryableStatuses?: HttpStatusMatcher | readonly HttpStatusMatcher[]`
2. `retryAfter?: 'respect' | 'ignore'`

**Evidence**:
- **Implementation**: `restale-kit/src/client/core/client-contracts.ts:80-90`
- **Documentation (client.md)**: Both are documented and explained in the client guide

**Fix Required**: Add both missing properties to the interface definition.

---

### 10. **API Reference**: Non-Existent `updateClientContext` Method (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `UseReStaleResult` interface

**Issue**: Documentation claims `updateClientContext(clientContext: JSONValue): Promise<void>` exists, but it does NOT exist in the implementation.

**Documented**:
```ts
interface UseReStaleResult {
  connectionId: string
  connection: ConnectionStatus
  isConnected: boolean
  reconnect(): Promise<void>
  close(): void
  updateClientContext(clientContext: JSONValue): Promise<void>  // ❌ DOES NOT EXIST
}
```

**Evidence**:
- **Implementation**: `restale-kit/src/client/react/useReStale.ts:99-110` — `UseReStaleResult` does NOT include `updateClientContext`
- **Grep Search**: No occurrences of `updateClientContext` anywhere in the codebase
- **Actual Return**: The hook returns `{ connectionId, connection, ...helpers, reconnect, close }` — no `updateClientContext`

**Fix Required**: **REMOVE** `updateClientContext` from the documented interface. This method does not exist.

---

### 11. **API Reference**: Missing Helper Booleans in `UseReStaleResult` (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `UseReStaleResult` interface

**Issue**: The implementation returns additional helper boolean properties that are NOT documented.

**Documented**:
```ts
interface UseReStaleResult {
  connectionId: string
  connection: ConnectionStatus
  isConnected: boolean  // ✅ Documented
  reconnect(): Promise<void>
  close(): void
}
```

**Actual Implementation** (`restale-kit/src/client/react/useReStale.ts:99-110`):
```ts
interface UseReStaleResult {
  connectionId: string
  connection: ConnectionStatus
  attempt: number           // ❌ Missing
  isConnecting: boolean     // ❌ Missing
  isConnected: boolean      // ✅ Documented
  isReconnecting: boolean   // ❌ Missing
  isClosed: boolean         // ❌ Missing
  reconnect(): Promise<void>
  close(): void
}
```

**Evidence**: See `restale-kit/src/client/react/useReStale.ts:333-347`

**Fix Required**: Add all helper properties to the documented interface:

```ts
interface UseReStaleResult {
  connectionId: string
  connection: ConnectionStatus
  attempt: number
  isConnecting: boolean
  isConnected: boolean
  isReconnecting: boolean
  isClosed: boolean
  reconnect(): Promise<void>
  close(): void
}
```

---

### 12. **API Reference**: Non-Existent `closeWithUnmount` Method (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `SSEInvalidatorClient` class

**Issue**: Documentation lists `closeWithUnmount(): void` as a public method, but it is NOT intended for public use.

**Documented**:
```ts
class SSEInvalidatorClient {
  // ...
  close(): void
  closeWithUnmount(): void  // ❌ Internal, not for public use
}
```

**Evidence**:
- **Implementation**: `restale-kit/src/client/core/sse-client.ts:266` — The method exists
- **Comment**: "Called by framework wrappers on component unmount (reason: 'unmount') — use close() in non-React code."
- **Usage**: Only called by `useReStale` hook internally
- **Documentation (client.md:277)**: Explicitly states "Behaves like close() but sets reason to 'unmount' — use close() in non-React code."

**Fix Required**: **REMOVE** `closeWithUnmount()` from the API reference OR clearly mark it as internal/framework-only:

```ts
// Called by framework wrappers on component unmount (reason: 'unmount')
// Use close() in non-React code instead.
// closeWithUnmount(): void  // Internal - do not call directly
```

---

### 13. **API Reference**: Missing `ClientOptions` Properties (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `ClientOptions` interface

**Issue**: The documented `ClientOptions` interface is incomplete.

**Documented Properties**:
- `autoReconnect`
- `withCredentials`
- `reconnect`
- `target`
- `clientContext`  ❌ Does not exist

**Missing Properties** (from implementation `restale-kit/src/client/core/client-contracts.ts:102-113`):
- `debug?: boolean`
- `callback?: AdaptedInvalidateCallback<...> | ((signal: ...) => void)`
- `onConnect?: (event: Event) => void`
- `onDisconnect?: (event: Event) => void`
- `onError?: (error: unknown) => void`

**Also**: `clientContext` is documented but does NOT exist in the implementation.

**Fix Required**: 
1. Remove `clientContext` (does not exist)
2. Add the missing properties

---

### 14. **Client Guide**: Missing `attempt` Property (docs/client.md)

**Location**: `docs/client.md` — `SSEInvalidatorClient` properties section (line 258)

**Issue**: Documentation does NOT mention the `attempt` property.

**Actual API** (`restale-kit/src/client/core/sse-client.ts:245-248`):
```ts
get attempt(): number {
  return this.currentAttempt
}
```

**Evidence**: Used throughout the implementation and exposed as a public getter.

**Fix Required**: Add `attempt` to the client properties documentation:

```ts
// Current reconnect attempt count (0 on initial connect or after success)
console.log('Current attempt:', client.attempt)
```

---

### 15. **Client Guide**: Missing `updateRuntimeOptions` Method (docs/client.md)

**Location**: `docs/client.md` — vanilla client API

**Issue**: The `updateRuntimeOptions` method is NOT documented.

**Evidence**:
- **Implementation**: `restale-kit/src/client/core/sse-client.ts:227-259` — Public method
- **Signature**: `updateRuntimeOptions(opts?: Pick<ClientOptions<TSignal>, 'autoReconnect' | 'reconnect' | 'debug'>): void`
- **Purpose**: Allows updating runtime options without recreating the client

**Fix Required**: Add documentation for this method in the vanilla client section.

---

---

### 16. **API Reference**: Missing Frame Guard Types (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit` core types section

**Issue**: Frame Guard types are exported but NOT documented in the API reference.

**Missing Types** (from `restale-kit/src/types/index.ts`):
1. `LifetimeOptions` — exported, not documented
2. `OnDeadline` — exported, not documented  
3. `FrameGuardResult` — exported, not documented
4. `FrameGuardCtx` — exported, not documented
5. `BeforeFrameFn` — exported, not documented

**Evidence**:
- **Implementation**: All types are defined in `restale-kit/src/types/protocol.ts:300-385`
- **Exports**: All are exported from `restale-kit/src/types/index.ts:20-22`
- **Usage**: Used in server docs (server.md) but NOT in API reference
- **Documentation**: Missing from API reference type list

**Fix Required**: Add all Frame Guard types to the `restale-kit` core exports section:

```ts
import type {
  // ... existing types
  LifetimeOptions,
  OnDeadline,
  FrameGuardResult,
  FrameGuardCtx,
  BeforeFrameFn,
} from 'restale-kit'
```

And define them:

```ts
type OnDeadline =
  | 'reconnect'
  | 'revoke'
  | { maxAttempts?: number; retryDelayMs?: number }

type LifetimeOptions =
  | { ttlMs: number; deadline?: never; onDeadline?: OnDeadline }
  | { deadline: number; ttlMs?: never; onDeadline?: OnDeadline }

type FrameGuardResult =
  | { action: 'send' }
  | { action: 'skip' }
  | { action: 'close'; reason?: string }

type FrameGuardCtx<TSignal extends InvalidateSignal = InvalidateSignal> =
  | SignalFrameCtx<TSignal>
  | KeepaliveFrameCtx

type BeforeFrameFn<TSignal extends InvalidateSignal = InvalidateSignal> =
  (ctx: FrameGuardCtx<TSignal>) => FrameGuardResult
```

---

### 17. **API Reference**: Missing `EventStore` Related Types (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/server` section

**Issue**: The API reference mentions these types in the text but does NOT provide type definitions.

**Listed but NOT Defined**:
```ts
import type { EventStore, EventStoreOptions, EventRecord, EventStoreResult } from 'restale-kit/server'
```

**Evidence**:
- **Implementation**: All types defined in `restale-kit/src/server/core/event-store.ts` and `restale-kit/src/types/protocol.ts`
- **Exports**: `restale-kit/src/server/core/index.ts:9-10` exports all of them
- **Documentation**: Import statement exists but no type definitions provided

**Fix Required**: Add type definitions for all EventStore-related types:

```ts
interface EventStoreOptions {
  capacity?: number          // default 100
  idGenerator?: () => string
}

interface EventStore<TSignal extends InvalidateSignal = InvalidateSignal> {
  readonly add: (signal: TSignal | TSignal[], customId?: string) => EventRecord<TSignal>
  readonly getEventsAfter: (lastEventId: string) => EventStoreResult<TSignal>
  readonly clear: () => void
}

interface EventRecord<TSignal extends InvalidateSignal = InvalidateSignal> {
  id: string
  signal: TSignal | TSignal[]
}

interface EventStoreResult<TSignal extends InvalidateSignal = InvalidateSignal> {
  events: EventRecord<TSignal>[]
  stale: boolean
}
```

---

### 18. **API Reference**: Missing `ChannelDefaults` Type (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/server` section

**Issue**: `ChannelDefaults` is used in constructor options but NOT defined.

**Evidence**:
- **Implementation**: Defined in `restale-kit/src/server/core/merge-channel-defaults.ts:8-14`
- **Exports**: `restale-kit/src/server/core/index.ts:11` exports it
- **Usage**: Referenced in `SSEChannelGroupOptions.channelDefaults`
- **Documentation**: Not defined in API reference

**Fix Required**: Add the type definition:

```ts
interface ChannelDefaults {
  target?: SignalTarget | SignalTarget[] | readonly SignalTarget[]
  lifetime?: LifetimeOptions
  guardKeepalive?: boolean
  eventBufferCapacity?: number
}
```

---

### 19. **API Reference**: Missing `mergeChannelDefaults` Export (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/server` section

**Issue**: `mergeChannelDefaults` function is exported but NOT documented.

**Evidence**:
- **Implementation**: `restale-kit/src/server/core/merge-channel-defaults.ts:34`
- **Exports**: `restale-kit/src/server/core/index.ts:10` explicitly exports it
- **Documentation**: Not listed in API reference

**Fix Required**: Add to the `restale-kit/server` exports:

```ts
import { mergeChannelDefaults } from 'restale-kit/server'

function mergeChannelDefaults<TSignal extends InvalidateSignal = InvalidateSignal>(
  channelOptions: SSEChannelOptions<TSignal>,
  defaults: ChannelDefaults | undefined
): SSEChannelOptions<TSignal>
```

---

### 20. **API Reference**: Missing `FastifyRequestLike` and `FastifyReplyLike` Types (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/server` section

**Issue**: These types are exported and used in `attachNodeResponse` but NOT defined.

**Evidence**:
- **Exports**: `restale-kit/src/server/core/index.ts:7` explicitly exports them
- **Usage**: Used in `attachNodeResponse` method signature
- **Documentation**: Not defined in API reference

**Fix Required**: Add type definitions (structural interfaces compatible with Fastify):

```ts
import type { FastifyRequestLike, FastifyReplyLike } from 'restale-kit/server'

interface FastifyRequestLike {
  raw: IncomingMessage
}

interface FastifyReplyLike {
  raw: ServerResponse
  hijack(): void
}
```

---

### 21. **API Reference**: Missing `IncomingMessage` and `ServerResponse` Imports (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/server` section

**Issue**: `attachNodeResponse` signature references Node.js types without showing where they come from.

**Evidence**:
- **Usage**: `attachNodeResponse(req: IncomingMessage | FastifyRequestLike, res: ServerResponse | FastifyReplyLike, ...)`
- **Documentation**: No indication that these are from `node:http`

**Fix Required**: Add import statement:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
```

---

### 22. **Server Guide**: Missing `createEventStore` Example (docs/server.md)

**Location**: `docs/server.md` — "Reconnection & Event History Replay" section (line 343)

**Issue**: Shows `createEventStore` usage but never shows the actual import.

**Evidence**:
- **Usage**: Line 343 shows `const eventStore = createEventStore({ capacity: 100 })`
- **Import**: Missing from the code block

**Fix Required**: Add the import at the top of the example:

```ts
import { createEventStore, SSEChannelGroup } from 'restale-kit/server'
```

---

### 23. **API Reference**: `internal_attachSSE` is Internal, Not Public (docs/api-reference.md)

**Location**: N/A (not documented, which is correct)

**Issue**: NOT an issue — confirming correctness

**Evidence**:
- **Implementation**: `restale-kit/src/server/node/attach.ts:26` — function is prefixed with `internal_`
- **Usage**: Only used internally by `SSEChannelGroup.attachNodeResponse`
- **Documentation**: Correctly NOT listed in public API reference

**Conclusion**: This is correctly handled. `attachSSE` does NOT exist as a public function. Users call `group.attachNodeResponse()`, which internally uses `internal_attachSSE()`.

---

### 24. **API Reference**: Missing `DirectSSEChannelOptions` Type (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/server` section

**Issue**: `DirectSSEChannelOptions` is exported but NOT documented.

**Evidence**:
- **Exports**: `restale-kit/src/server/core/index.ts:4` exports it
- **Usage**: Used when calling `createSSEChannel` directly (requires explicit `target`)
- **Documentation**: Not defined in API reference

**Fix Required**: Add the type (or at least note its existence):

```ts
// DirectSSEChannelOptions is the same as SSEChannelOptions but with required target
interface DirectSSEChannelOptions<TTarget extends SignalTarget | SignalTarget[] = SignalTarget>
  extends SSEChannelOptions {
  target: TTarget  // required (not optional like in SSEChannelOptions)
}
```

---

### 25. **API Reference**: Missing Action Type Constants (docs/api-reference.md)

**Location**: `docs/api-reference.md` — core types section

**Issue**: The type definitions show action types as string literals, but the implementation exports constant arrays.

**Evidence**:
- **Implementation**: `restale-kit/src/types/protocol.ts:15-18, 35-36, 55-56`
  ```ts
  export const TANSTACK_QUERY_ACTIONS = ['invalidate', 'refetch', 'reset', 'remove', 'cancel'] as const
  export const SWR_ACTIONS = ['revalidate', 'purge', 'remove', 'mutate'] as const
  export const GENERIC_ACTIONS = ['invalidate', 'refetch', 'remove'] as const
  ```
- **Exports**: These constants are NOT re-exported from any public entry point
- **Documentation**: Shows the types but not the constants

**Fix Required**: Either:
1. Document that these constants exist for runtime validation
2. OR note that they are internal implementation details

**Note**: Since they're not exported from public entry points, they may be intentionally internal.

---

### 26. **Client Guide & API Reference**: Missing RTK Query Adapter Documentation (docs/client.md, docs/api-reference.md)

**Location**: Both `docs/client.md` and `docs/api-reference.md`

**Issue**: RTK Query adapter is completely undocumented.

**Evidence**:
- **Package Export**: `package.json:74` exports `./rtk-query` entry point
- **Implementation**: `restale-kit/src/client/rtk-query/index.ts` exports `rtkQueryAdapter` and `useRtkQueryAdapter`
- **Client Guide**: No mention of RTK Query adapter at all
- **API Reference**: No `restale-kit/rtk-query` section

**Expected Exports**:
```ts
export { rtkQueryAdapter, useRtkQueryAdapter } from './adapter.js'
export type { RTKQuerySignalInput, RTKQueryApiLike } from './adapter.js'
```

**Fix Required**: Add complete RTK Query adapter documentation to both files.

---

### 27. **API Reference**: Missing `QueryClientLike` Type Export (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/tanstack-query` section

**Issue**: `QueryClientLike` type is exported but not documented.

**Evidence**:
- **Exports**: `restale-kit/src/client/tanstack-query/index.ts:4` exports it
- **Documentation**: Not listed in the type exports

**Fix Required**: Add to the exports:

```ts
import { 
  tanstackQueryAdapter, 
  useTanstackQueryAdapter,
  type QueryClientLike  // <-- MISSING
} from 'restale-kit/tanstack-query'
```

---

### 28. **API Reference**: Missing `AdaptedInvalidateCallback` Type (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/client` section

**Issue**: `AdaptedInvalidateCallback` is referenced in return types but never defined.

**Evidence**:
- **Implementation**: Defined in `restale-kit/src/client/core/client-contracts.ts:13-24`
- **Usage**: Return type of all adapter functions
- **Documentation**: Referenced but not defined

**Fix Required**: Add the type definition:

```ts
type AdaptedInvalidateCallback<
  TTarget extends SignalTarget = SignalTarget,
  TSignal extends InvalidateSignal = InvalidateSignal,
> = ((signal: TSignal | TSignal[]) => void) & {
  readonly target: TTarget
  readonly __restaleTarget: TTarget
}
```

---

### 29. **API Reference**: Missing `SignalTarget` Type Definition (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit` core types section

**Issue**: `SignalTarget` is referenced everywhere but never defined.

**Evidence**:
- **Implementation**: `restale-kit/src/types/protocol.ts:65`
  ```ts
  export type SignalTarget = (typeof SIGNAL_TARGETS)[keyof typeof SIGNAL_TARGETS]
  ```
- **Documentation**: Used but not defined

**Fix Required**: Add the type definition:

```ts
type SignalTarget = 'tanstack-query' | 'swr' | 'rtk-query' | 'generic'
// Derived from: (typeof SIGNAL_TARGETS)[keyof typeof SIGNAL_TARGETS]
```

---

### 30. **API Reference**: Missing `PubSubMessage` Type Definition (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/pubsub` section

**Issue**: `PubSubMessage` is listed in imports but never defined.

**Evidence**:
- **Implementation**: `restale-kit/src/types/protocol.ts:239-242`
  ```ts
  export type PubSubMessage<TSignal extends InvalidateSignal = InvalidateSignal> =
    | { kind: 'signal'; data: TSignal | TSignal[]; id?: string }
    | { kind: 'control'; data: JSONValue }
  ```
- **Documentation**: Import statement exists but no definition

**Fix Required**: Add the discriminated union definition.

---

### 31. **API Reference**: Missing `StandardSchemaV1` Namespace Members (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit` core types section

**Issue**: `StandardSchemaV1` is imported but its structure is not documented.

**Evidence**:
- **Implementation**: `restale-kit/src/types/standard-schema.ts:10-40` defines the full interface including `Result`, `SuccessResult`, `FailureResult`, and `Issue` types
- **Documentation**: Listed as import but not defined

**Fix Required**: Add the complete interface structure:

```ts
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
      options?: { libraryOptions?: Record<string, unknown> }
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>
    readonly types?: {
      readonly input: Input
      readonly output: Output
    }
  }
}

namespace StandardSchemaV1 {
  type Result<Output> = SuccessResult<Output> | FailureResult

  interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }

  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }

  interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>
  }
}
```

---

### 32. **API Reference**: Missing `validateStandardSchema` Function (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit` core utilities section

**Issue**: Function is exported but not documented.

**Evidence**:
- **Implementation**: `restale-kit/src/types/standard-schema.ts:51` defines it
- **Exports**: `restale-kit/src/types/index.ts:2` exports it
- **Documentation**: Not listed in utilities section

**Fix Required**: Add to utilities section:

```ts
function validateStandardSchema<T>(
  value: unknown,
  schema: StandardSchemaV1<unknown, T>
): T
// Throws SchemaValidationError if validation fails or schema is async
```

---

### 33. **Validation Guide**: Wrong `optimisticData` Field (docs/validation.md)

**Location**: `docs/validation.md` — SWRSignal validation section (line 31)

**Issue**: Documentation claims `optimisticData` is a valid field for `SWRSignal`.

**Documented**:
```markdown
- `optimisticData` (if present) must be a valid JSON-serializable value...
  Pushes instant optimistic data updates directly to SWR cache.
```

**Evidence**:
- **Implementation**: `restale-kit/src/types/protocol.ts:40-45` — `SWRSignal` interface does NOT have `optimisticData` field
- **Actual Fields**: `target`, `key`, `action`, `revalidate`, `match`

**Fix Required**: **REMOVE** the `optimisticData` field documentation — it does not exist.

---

### 34. **API Reference**: Missing SSEChannel Properties Documentation (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/server` section

**Issue**: SSEChannel interface properties are not fully documented.

**Missing Properties**:
- `readonly state: ChannelState`
- `readonly connectionId: string`
- `readonly target: SignalTarget | readonly SignalTarget[]`
- `readonly requestedTarget: string | undefined`
- `readonly stream: ReadableStream<Uint8Array>`

**Evidence**:
- **Implementation**: `restale-kit/src/server/core/channel.ts:73-83` defines all properties
- **Documentation**: Properties not shown in SSEChannel interface

**Fix Required**: Document the full interface with all readonly properties.

---

### 35. **API Reference**: Missing SSEChannel Methods Documentation (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/server` section

**Issue**: SSEChannel methods are not fully documented.

**Missing Methods**:
- `close(): void`
- `disconnect(): void`
- `revoke(reason?: string): void`
- `onClose(callback: () => void): void`

**Evidence**:
- **Implementation**: `restale-kit/src/server/core/channel.ts:95-108` defines all methods
- **Documentation**: Methods not shown in interface

**Fix Required**: Document all methods with descriptions.

---

### 36. **Client Guide**: `RejectedConnectionResponse` Headers Type Wrong (docs/client.md)

**Location**: `docs/client.md` — `ConnectionStatus` type definition (line 92)

**Issue**: Documentation shows wrong type for `headers` property.

**Documented**:
```ts
{ status: 'closed'; reason: 'rejected'; response: { status: number, headers: Record<string, string[]> } }
```

**Actual Implementation** (`restale-kit/src/client/core/client-contracts.ts:68-71`):
```ts
interface RejectedConnectionResponse {
  status: number
  headers: Readonly<Record<string, readonly string[]>>  // Note: readonly modifiers
}
```

**Fix Required**: Update the type to include `readonly` modifiers for correctness.

---

### 37. **API Reference**: Missing Connection Status `rejected` Variant (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `ConnectionStatus` type definition

**Issue**: The `rejected` variant is missing from the documented type.

**Documented**:
```ts
type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
  | { status: 'error'; error: Event }
```

**Missing**:
```ts
| { status: 'closed'; reason: 'rejected'; response: RejectedConnectionResponse }
```

**Evidence**: `restale-kit/src/client/core/client-contracts.ts:49` defines it

**Fix Required**: Add the `rejected` variant to the type union.

---

### 38. **API Reference**: Missing `TanStackQueryAdapterOptions` Type (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/tanstack-query` section

**Issue**: `TanStackQueryAdapterOptions` is referenced but not defined.

**Evidence**:
- **Usage**: Parameter of both `tanstackQueryAdapter` and `useTanstackQueryAdapter`
- **Documentation**: Referenced but not defined

**Fix Required**: Add the type definition (or note if it's an empty interface).

---

### 39. **Server Guide**: Missing `scope` Parameter Type (docs/server.md)

**Location**: `docs/server.md` — `revokeByConnectionId` section (line 263)

**Issue**: Documentation doesn't show the full type signature for `scope` parameter.

**Documented**:
```ts
await group.revokeByConnectionId(connectionId, scope?: Record<string, JSONValue>)
```

**Actual Implementation** (from `restale-kit/src/server/core/channel-group.ts:695-697`):
```ts
scope?: TMeta extends object
  ? Partial<Record<keyof TMeta, JSONValue | undefined>>
  : Record<string, JSONValue | undefined>
```

**Issue**: The type is more complex and metadata-aware than documented.

**Fix Required**: Update documentation to note the type is inferred from `TMeta`.

---

### 40. **API Reference**: Missing `GroupSignalInput` Type (docs/api-reference.md)

**Location**: `docs/api-reference.md` — `restale-kit/server` section

**Issue**: `GroupSignalInput` is used in method signatures but not defined.

**Evidence**:
- **Usage**: Used in `broadcast`, `broadcastToAll`, `publish` method signatures
- **Implementation**: Defined in `restale-kit/src/server/core/channel-group.ts:97-107`
- **Documentation**: Not defined

**Fix Required**: Either inline the complex type or provide a simplified explanation.

---

## Summary Statistics

- **Total Issues Found**: 40
- **Critical API Mismatches**: 4
  - Non-existent `updateClientContext` method
  - Wrong `SIGNAL_TARGETS` property names (TANSTACK vs TANSTACK_QUERY)
  - Non-existent `closeWithUnmount` as public API
  - Non-existent `optimisticData` field in SWRSignal
- **Missing Complete Sections**: 1
  - RTK Query adapter completely undocumented
- **Missing Type Exports & Definitions**: 20
  - Frame Guard types (5 types)
  - EventStore types (4 types)
  - Core types (SignalTarget, PubSubMessage, AdaptedInvalidateCallback, StandardSchemaV1, etc.)
  - Adapter-specific types (QueryClientLike, TanStackQueryAdapterOptions, etc.)
  - Type modifiers (readonly in RejectedConnectionResponse)
- **Incomplete Interfaces**: 6
  - UseReStaleResult (missing helper booleans)
  - ClientOptions (wrong properties)
  - ReconnectOptions (missing properties)
  - ConnectionStatus (missing rejected variant)
  - SSEChannel (missing properties and methods)
  - UseReStaleOptions (missing onRejected)
- **Missing Function Documentation**: 3
  - `validateStandardSchema`
  - `mergeChannelDefaults`
  - `createEventStore` import
- **Type Accuracy Issues**: 2
  - RejectedConnectionResponse headers readonly modifiers
  - `scope` parameter type in revokeByConnectionId
- **Confirmed Correct**: 1
  - `internal_attachSSE` correctly not documented

## Recommended Actions

1. **CRITICAL (Immediate)**:
   - Fix wrong `SIGNAL_TARGETS` property names (TANSTACK → TANSTACK_QUERY)
   - Remove non-existent `updateClientContext` method
   - Clarify `closeWithUnmount` is internal/framework-only

2. **HIGH PRIORITY**:
   - Add all missing Frame Guard types (5 types)
   - Add all missing EventStore types (4 types)
   - Add missing event definitions (`rejected`, `renew`, `retriesexhausted`)
   - Add missing callback types (`onRejected`, `RejectedConnectionResponse`)

3. **MEDIUM PRIORITY**:
   - Complete interface definitions (helper booleans, options properties)
   - Add missing type exports (`ChannelDefaults`, Fastify types, `DirectSSEChannelOptions`)
   - Document exported utility functions (`mergeChannelDefaults`)

4. **LOW PRIORITY**:
   - Add missing imports to examples (`createEventStore`)
   - Add convenience property documentation (`attempt`, `updateRuntimeOptions`)

---

### 41. **Getting Started & Server Guide**: Missing Explanation of Wire Behavior (docs/getting-started.md, docs/server.md)

**Location**: Multiple locations

**Issue**: Documentation does NOT explain what actually happens to the `target` property during transmission.

**Current Documentation** (docs/server.md line 179-183):
- Says callers can omit `target` on single-target groups
- Says target is "automatically attached internally"
- Says "Wire Optimization: outgoing SSE byte frame strips the `target` property"

**Problem**: This creates confusion about:
1. When is target required vs optional?
2. What does the client actually receive?
3. Does the client need to handle signals without target?

**Fix Required**: Add clear explanation that:
- Server: Target is auto-attached before storage/pubsub but stripped before wire transmission
- Client: Receives signals without `target` property; adapter is responsible for handling its own format

---

### 42. **Getting Started**: Example Lacks Important Context About Metadata (docs/getting-started.md)

**Location**: `docs/getting-started.md` — Example around line 68

**Issue**: The "heads up" note about metadata appears AFTER the example, which means readers might already have implemented it wrong.

**Current Flow**:
1. Shows example without metadata
2. Example works for `broadcastToAll`
3. Later mentions limitations (can't use per-user invalidation)

**Problem**: Many users will implement the example and only later realize they can't:
- Use `broadcast((meta) => ...)` for targeted invalidation
- Use `revokeWhere({ userId })` for per-user session control
- Implement any user-specific features

**Fix Required**: Move the metadata warning BEFORE the example, or show the correct pattern from the start.

---

### 43. **Server Guide**: `register` Section is Misleading (docs/server.md)

**Location**: `docs/server.md` — "register and deregister" section (lines 131-151)

**Issue**: The section documents `group.register(channel, meta)` as if users call it directly, but users NEVER call this method.

**Why This is Misleading**:
- `attachNodeResponse` and `createFetchResponse` call `register` internally
- Users have no `channel` object to pass to `register()`
- The section suggests a two-step process that doesn't exist

**Documented**:
```ts
// If TMeta accepts undefined, metadata is optional:
group.register(channel)  // ❌ Users never have a 'channel' to pass here

// If TMeta does not accept undefined, metadata is required:
group.register(channel, meta)
```

**Reality**:
```ts
// Users actually do this:
group.attachNodeResponse(req, res, { meta })  // This calls register internally
```

**Fix Required**: 
- Mark this section as "Advanced" or "For Library Authors"
- OR rewrite to explain that registration happens automatically via attach methods
- OR remove this section entirely since it's internal

---

### 44. **Client Guide**: Reconnect Formula Not Documented (docs/client.md)

**Location**: `docs/client.md` — reconnect strategy section (bottom of file)

**Issue**: Documentation mentions exponential backoff but doesn't show the actual formula.

**Documented**:
```markdown
When `autoReconnect: true` (default), failed connections retry with exponential backoff + jitter:
```

Then shows text description without the formula.

**Actual Implementation** (`restale-kit/src/client/core/backoff.ts:29`):
```ts
let delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)
```

**Fix Required**: Add the formula explicitly:

```markdown
Formula: delay = min(baseDelayMs × 2^attempt, maxDelayMs)
With jitter: delay × random(0.5, 1.5)
```

---

### 45. **API Reference**: `X-ReStale-Supported` Header Not Documented (docs/api-reference.md)

**Location**: Not documented anywhere

**Issue**: Server docs mention that `X-ReStale-Supported` header is emitted but never documents its format or purpose.

**Documented in server.md line 14**:
> They also emit `X-ReStale-Supported: <comma-separated-targets>` listing supported targets.

**Missing**:
- What is the exact format?
- When would a client use this?
- Is it always sent?

**Fix Required**: Document the header format and purpose, especially since it's used in the `unsupported-target` revoke flow.

---

### 46. **Validation Guide**: Example Missing Import (docs/validation.md)

**Location**: `docs/validation.md` — metadata validation example (line 60)

**Issue**: Example imports `z` from `'zod'` but doesn't show importing `InvalidateSignal`.

**Current**:
```ts
import { z } from 'zod'
import { SSEChannelGroup } from 'restale-kit/server'

const ClientMetaSchema = z.object({
  userId: z.string(),
  role: z.enum(['user', 'admin']),
})
type ClientMeta = z.infer<typeof ClientMetaSchema>

const group = new SSEChannelGroup<InvalidateSignal, ClientMeta>({  // Where does InvalidateSignal come from?
```

**Fix Required**: Add the import:
```ts
import { SSEChannelGroup, type InvalidateSignal } from 'restale-kit/server'
```

OR
```ts
import type { InvalidateSignal } from 'restale-kit'
```

---

### 47. **Getting Started**: Note About `__restale_cid__` Uses Wrong Wording (docs/getting-started.md)

**Location**: `docs/getting-started.md` — Note after server example (line 67)

**Issue**: The note says "requires the `__restale_cid__` query parameter" which sounds like a mandatory URL parameter users must add.

**Current Wording**:
> **Note:** `group.attachNodeResponse` / `group.createFetchResponse` requires the `__restale_cid__` query parameter on the request URL.

**Problem**: This makes it sound like users need to add `?__restale_cid__=something` to their SSE endpoint configuration.

**Reality**: The client library automatically adds this parameter. Users should NEVER touch it.

**Better Wording**:
> **Note:** The client SDK automatically appends a `__restale_cid__` connection ID parameter to the SSE endpoint URL. `group.attachNodeResponse` / `group.createFetchResponse` read this parameter automatically. You never need to add it manually. If you open the SSE endpoint directly in a browser or with curl without this parameter, you'll get an error.

---

### 48. **Client Guide**: Missing `await` on async `connect()` Call (docs/client.md)

**Location**: `docs/client.md` — vanilla client example (line 287)

**Issue**: Example shows `await client.connect()` which is correct, but the return value behavior table doesn't explain when to use await vs fire-and-forget.

**Current Example** (CORRECT):
```ts
await client.connect()
```

**Missing Explanation**: The docs don't explain:
- When should you `await` vs just call `client.connect()`?
- What happens if you don't await?
- When does the promise reject?

**Fix Required**: Add note explaining:
```ts
// Wait for connection to open before proceeding
await client.connect()

// OR fire-and-forget, listen to 'statuschange' events
client.connect()
client.addEventListener('statuschange', (event) => {
  if (event.detail.status === 'open') {
    // Connection is ready
  }
})
```

---

### 49. **Client Guide**: `reconnect()` Missing `void` Operator Example (docs/client.md)

**Location**: `docs/client.md` — connection status UI example (line 201)

**Issue**: Example shows `onClick={() => void reconnect()}` without explaining why `void` is needed.

**Current Example**:
```tsx
return <button onClick={() => void reconnect()}>Reconnect</button>
```

**Problem**: New React developers might not understand:
- Why `void` is used
- That `reconnect()` returns a Promise
- When to await vs void

**Fix Required**: Add explanatory comment or show both patterns:
```tsx
// Fire-and-forget (common for UI buttons)
<button onClick={() => void reconnect()}>Reconnect</button>

// OR with loading state
const [reconnecting, setReconnecting] = useState(false)
<button 
  onClick={async () => {
    setReconnecting(true)
    await reconnect()
    setReconnecting(false)
  }}
>
  {reconnecting ? 'Connecting...' : 'Reconnect'}
</button>
```

---

### 50. **Pub/Sub Guide**: Missing `await` on async Operations (docs/pubsub.md)

**Location**: `docs/pubsub.md` — examples throughout

**Issue**: Examples correctly show `await` but don't explain consequences of missing it.

**Examples** (CORRECT):
```ts
await group.publish(`user:${userId}`, { key: ['todos'] })
await group.revokeByConnectionId(connectionId, { userId, sessionId })
```

**Problem**: Users might remove `await` and not realize:
- Message might not be published before function returns
- Revocation might not complete before sending HTTP response
- Errors won't be caught

**Fix Required**: Add warning:
```ts
// ⚠️ ALWAYS await these operations:
await group.publish(...)        // Ensures message reaches broker before continuing
await group.revokeWhere(...)    // Ensures revocation completes cluster-wide
await group.revokeByConnectionId(...)  // Ensures connection closes before responding
```

---

### 51. **Server Guide**: `dispose()` Missing in Shutdown Example (docs/server.md)

**Location**: `docs/server.md` — teardown section (line 368)

**Issue**: Example shows `await group.dispose()` but never explains what it actually does.

**Current**:
```ts
process.on('SIGTERM', async () => {
  await group.dispose()
  server.close()
})
```

**Missing Explanation**:
- What does `dispose()` actually do?
- What happens if you don't call it?
- Does it close active connections?

**Fix Required**: Add explanation:
```ts
// Teardown: unsubscribe from pub/sub control topic
// Does NOT close active SSE connections (they remain open)
process.on('SIGTERM', async () => {
  await group.dispose()  // Clean shutdown of pub/sub subscriptions
  server.close()         // Then close HTTP server (this closes SSE streams)
})
```

---

### 52. **Client Guide**: Missing Default Values in TanStack Query Action Mapping (docs/client.md)

**Location**: `docs/client.md` — TanStack Query adapter section (line 322)

**Issue**: Table shows `action: 'invalidate'` (default) but doesn't explain what happens when `action` is omitted.

**Current Table**:
```markdown
| `action: 'invalidate'` (default) | `'invalidate'` | `queryClient.invalidateQueries(filters)` |
```

**Problem**: Users don't know:
- Can I omit the `action` property?
- What's the actual default behavior?
- Is `action` required or optional?

**Fix Required**: Add explanation before table:
```markdown
**Default behavior:** When `action` is omitted, defaults to `'invalidate'`.

Example:
```ts
// These are equivalent:
{ queryKey: ['todos'] }                      // action defaults to 'invalidate'
{ queryKey: ['todos'], action: 'invalidate' }
```

---

### 53. **Client Guide**: SWR `match` Default Not Documented (docs/client.md)

**Location**: `docs/client.md` — SWR adapter section (line 385)

**Issue**: Table mentions `match: 'exact' | 'prefix'` but never states the default.

**Current**:
```markdown
| `match` | `'exact' \| 'prefix'` | For string keys, controls exact vs prefix matching |
```

**Problem**: Users need to know:
- What's the default when `match` is omitted?
- For array keys, does `match` apply?

**Fix Required**: Add default documentation:
```markdown
| `match` | `'exact' \| 'prefix'` | For string keys, controls matching behavior. Default: `'prefix'` for string keys. Array keys always use structural matching (not affected by `match`). |
```

---

### 54. **Server Guide**: Multi-Target Example Shows Wrong Signal Format (docs/server.md)

**Location**: `docs/server.md` — broadcastByKey restrictions (line 233)

**Issue**: Example shows explicit `target` on both signals, but doesn't explain this is REQUIRED for multi-target.

**Current Example**:
```ts
group.broadcast(
  [
    { target: 'swr', key: ['todos', { userId: '42' }] },
    { target: 'tanstack-query', queryKey: ['todos', { userId: '42' }] },
  ],
  (meta) => meta.userId === '42'
)
```

**Missing**: No explanation that:
- `target` is REQUIRED (not optional) for multi-target groups
- You MUST provide signals for ALL targets
- Order doesn't matter but completeness does

**Fix Required**: Add explicit note:
```ts
// ⚠️ Multi-target groups REQUIRE:
// 1. Explicit target on EVERY signal
// 2. One signal for EACH configured target
group.broadcast(
  [
    { target: 'swr', key: ['todos', { userId: '42' }] },              // Required
    { target: 'tanstack-query', queryKey: ['todos', { userId: '42' }] },  // Required
  ],
  (meta) => meta.userId === '42'
)
```

---

### 55. **Pub/Sub Guide**: Missing Error Handling Examples (docs/pubsub.md)

**Location**: `docs/pubsub.md` — adapter examples throughout

**Issue**: No examples show error handling for pub/sub operations.

**Current**:
```ts
await group.publish(`user:${userId}`, { key: ['todos'] })
```

**Problem**: Users don't know:
- What errors can occur?
- Should I wrap in try/catch?
- What happens if broker is down?

**Fix Required**: Add error handling example:
```ts
try {
  await group.publish(`user:${userId}`, { key: ['todos'] })
} catch (error) {
  // Broker unreachable, network error, etc.
  // Log but don't fail the mutation
  console.error('Failed to publish invalidation:', error)
  // The mutation still succeeded, clients just won't get real-time update
  // They'll fetch stale data on next natural revalidation
}
```

---

### 56. **Client Guide**: Cross-Origin CORS Requirements Not Documented (docs/client.md)

**Location**: `docs/client.md` — cross-origin section (line 218)

**Issue**: Mentions CORS headers but doesn't show server-side setup.

**Current**:
```markdown
The server must respond with `Access-Control-Allow-Credentials: true` 
and a specific (non-`*`) `Access-Control-Allow-Origin`.
```

**Problem**: Doesn't show actual server code to set these headers.

**Fix Required**: Add server example:
```ts
// Server-side CORS for SSE with credentials
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)  // Must be specific origin
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  next()
})

app.get('/sse', (req, res) => {
  // SSE connection will include cookies now
  group.attachNodeResponse(req, res, {
    meta: { userId: req.user?.id },  // req.user available from cookie session
  })
})
```

---

### 57. **Validation Guide**: No Example of Catching Validation Errors (docs/validation.md)

**Location**: `docs/validation.md` — metadata validation section (line 83)

**Issue**: Shows `SchemaValidationError` being thrown but doesn't show how to handle it.

**Current**:
```ts
try {
  group.attachNodeResponse(req, res, { meta: invalidMeta })
} catch (err) {
  if (err instanceof SchemaValidationError) {
    console.error(err.message)
    console.error(err.issues)
  }
}
```

**Problem**: Doesn't show:
- What to return to the client
- Proper error response
- HTTP status code

**Fix Required**: Add complete error handling:
```ts
app.get('/sse', (req, res) => {
  try {
    group.attachNodeResponse(req, res, {
      meta: { userId: req.user?.id, role: req.user?.role },
    })
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      // Invalid metadata - reject the connection
      res.status(400).json({
        error: 'Invalid connection metadata',
        issues: err.issues,
      })
      return
    }
    // Other errors
    res.status(500).json({ error: 'Internal server error' })
  }
})
```

---

---

## Summary Statistics

- **Total Issues Found**: 48
- **Critical API Mismatches**: 4
  - Non-existent `updateClientContext` method
  - Wrong `SIGNAL_TARGETS` property names (TANSTACK vs TANSTACK_QUERY)
  - Non-existent `closeWithUnmount` as public API
  - Non-existent `optimisticData` field in SWRSignal
- **User-Facing Issues**: 8
  - Misleading `register()` documentation (suggests users call it directly)
  - Missing metadata warning placement (example before explanation)
  - Missing reconnect formula
  - Confusing `__restale_cid__` wording
  - Missing import in validation example
  - Undocumented `X-ReStale-Supported` header
  - Missing target property explanation
  - Wire behavior not clearly explained
- **Missing Complete Sections**: 1
  - RTK Query adapter completely undocumented
- **Missing Type Exports & Definitions**: 20
  - Frame Guard types (5 types)
  - EventStore types (4 types)
  - Core types (SignalTarget, PubSubMessage, AdaptedInvalidateCallback, StandardSchemaV1, etc.)
  - Adapter-specific types (QueryClientLike, TanStackQueryAdapterOptions, etc.)
  - Type modifiers (readonly in RejectedConnectionResponse)
- **Incomplete Interfaces**: 6
  - UseReStaleResult (missing helper booleans)
  - ClientOptions (wrong properties)
  - ReconnectOptions (missing properties)
  - ConnectionStatus (missing rejected variant)
  - SSEChannel (missing properties and methods)
  - UseReStaleOptions (missing onRejected)
- **Missing Function Documentation**: 3
  - `validateStandardSchema`
  - `mergeChannelDefaults`
  - `createEventStore` import
- **Type Accuracy Issues**: 2
  - RejectedConnectionResponse headers readonly modifiers
  - `scope` parameter type in revokeByConnectionId
- **Confirmed Correct**: 1
  - `internal_attachSSE` correctly not documented

## Summary Statistics

- **Total Issues Found**: 57
- **Critical API Mismatches**: 4
  - Non-existent `updateClientContext` method
  - Wrong `SIGNAL_TARGETS` property names (TANSTACK vs TANSTACK_QUERY)
  - Non-existent `closeWithUnmount` as public API
  - Non-existent `optimisticData` field in SWRSignal
- **High-Impact User-Facing Issues**: 17
  - Misleading `register()` documentation (suggests users call it directly)
  - Missing metadata warning placement (example before explanation)
  - Missing reconnect formula
  - Confusing `__restale_cid__` wording
  - Missing async/await best practices (9 examples)
  - Missing default values (action, match)
  - Missing error handling patterns (3 examples)
  - Missing CORS setup example
  - Multi-target requirements not explicit
- **Missing Complete Sections**: 1
  - RTK Query adapter completely undocumented
- **Missing Type Exports & Definitions**: 20
  - Frame Guard types (5 types)
  - EventStore types (4 types)
  - Core types (SignalTarget, PubSubMessage, AdaptedInvalidateCallback, StandardSchemaV1, etc.)
  - Adapter-specific types (QueryClientLike, TanStackQueryAdapterOptions, etc.)
  - Type modifiers (readonly in RejectedConnectionResponse)
- **Incomplete Interfaces**: 6
  - UseReStaleResult (missing helper booleans)
  - ClientOptions (wrong properties)
  - ReconnectOptions (missing properties)
  - ConnectionStatus (missing rejected variant)
  - SSEChannel (missing properties and methods)
  - UseReStaleOptions (missing onRejected)
- **Missing Function Documentation**: 3
  - `validateStandardSchema`
  - `mergeChannelDefaults`
  - `createEventStore` import
- **Type Accuracy Issues**: 2
  - RejectedConnectionResponse headers readonly modifiers
  - `scope` parameter type in revokeByConnectionId
- **Confirmed Correct**: 1
  - `internal_attachSSE` correctly not documented

## Recommended Actions (Prioritized by User Impact)

### 🔴 **CRITICAL** (Will cause runtime errors or confusion):
1. Fix wrong `SIGNAL_TARGETS` property names (TANSTACK → TANSTACK_QUERY)
2. Remove non-existent `updateClientContext` method
3. Remove non-existent `optimisticData` field from SWRSignal docs
4. Rewrite `register()` section (mark as advanced/internal, users never call this)
5. Clarify `__restale_cid__` note wording (sounds like users must add it)

### 🟠 **HIGH PRIORITY** (Will prevent correct usage):
6. Move metadata warning BEFORE getting-started example
7. Add async/await best practices and error handling patterns:
   - When to `await` vs fire-and-forget
   - Error handling for pub/sub operations
   - Validation error HTTP responses
8. Document missing defaults:
   - TanStack Query `action` defaults to `'invalidate'`
   - SWR `match` defaults to `'prefix'`
9. Add CORS setup example for cross-origin SSE
10. Make multi-target signal requirements explicit
11. Explain `dispose()` behavior (doesn't close connections)
12. Add reconnect formula: `delay = min(baseDelayMs × 2^attempt, maxDelayMs)`
13. Add complete RTK Query adapter documentation

### 🟡 **MEDIUM PRIORITY** (Missing but discoverable):
14. Add all Frame Guard type definitions
15. Add all EventStore type definitions  
16. Document `X-ReStale-Supported` header format and purpose
17. Complete all interface definitions
18. Add missing event types (`rejected`, `renew`, `retriesexhausted`)
19. Fix missing imports in examples

### 🟢 **LOW PRIORITY** (Polish):
20. Add helper boolean properties documentation
21. Document utility functions (`validateStandardSchema`, `mergeChannelDefaults`)
22. Add advanced type definitions (GroupSignalInput, SignalTarget, etc.)
23. Add `void` operator explanation for React examples

---

**End of Audit Report**
**Total: 57 documentation issues identified**
**Focus: 22 high-impact issues that will actually help users implement the library correctly**
