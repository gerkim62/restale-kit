# Remove Optimistic Data and Client Context Features

## Objective
Remove all optimisticData push features and clientContext functionality from the codebase, leaving only simple invalidation/revalidation signals. This simplifies the API and removes complex contextual broadcast functionality that proved too complicated for good DX.

## What to Remove

### 1. Optimistic Data Features
- Remove `optimisticData` field from all signal type interfaces:
  - `TanStackQuerySignal.optimisticData`
  - `SWRSignal.optimisticData`
  - `GenericInvalidateSignal.optimisticData`
- Remove `revalidateOptimisticData` option from adapter configurations:
  - `TanStackQueryAdapterOptions.revalidateOptimisticData`
  - `SWRAdapterOptions.revalidateOptimisticData`
- Remove optimistic data handling logic from adapters:
  - `restale-kit/src/client/tanstack-query/adapter.ts` - remove `setQueryData` calls
  - `restale-kit/src/client/swr/adapter.ts` - remove mutate calls with optimisticData
- Remove optimistic data validation logic:
  - `restale-kit/src/client/core/validation.ts` - remove optimisticData checks
  - `restale-kit/src/__tests__/audit/gap-12-jsonvalue-serialization.test.ts` - remove optimisticData test cases

### 2. Client Context Features
- Remove `TClientContext` type parameter from:
  - `SSEChannelGroup<TSignal, TMeta, TTarget, TClientContext>` - reduce to 3 params
  - All related interfaces and types
- Remove `clientContext` field and methods:
  - `SSEInvalidatorClient` - remove `clientContext` option and `updateClientContext()` method
  - `useReStale` hook - remove `clientContext` option and `updateClientContext` from return value
  - Server `SSEChannelGroup` - remove `updateClientContext()` and `getClientContext()` methods
- Remove `clientContextSchema` from:
  - `SSEChannelGroupOptions`
  - Constructor validation logic
- Remove client context storage:
  - Remove from connection registry entries
  - Remove client context sync logic in `useReStale.ts`
  - Remove POST endpoint handling for client context updates

### 3. Contextual Broadcast Features
- **Delete entire file**: `spec/targeted-contextual-broadcast.md`
- Remove `BroadcastContextualOptions` interface
- Remove `broadcast(options: BroadcastContextualOptions)` overload - keep only:
  - `broadcast(signal: TSignal | TSignal[], predicate?: (meta: TMeta | undefined) => boolean): void`
- Remove internal methods:
  - `broadcastContextualRaw()`
  - `broadcastContextual()`
  - `executeContextualBroadcastFromControl()`
  - `registerContextualHandler()`
- Remove `contextualSignal`, `contextualWhere`, `contextualHandlers` from:
  - Constructor options
  - Private class fields
  - All related logic
- Remove contextual broadcast control frame handling from:
  - `initControlSubscription()` - remove the `type === 'contextualBroadcast'` branch

### 4. Documentation Updates
- **docs/api-reference.md**:
  - Remove `optimisticData` from signal type definitions
  - Remove `revalidateOptimisticData` from adapter options
  - Remove `BroadcastContextualOptions` interface
  - Remove `broadcast(options)` overload documentation
  - Remove `updateClientContext()` and `getClientContext()` from SSEChannelGroup
  - Remove `TClientContext` type parameter from examples
  - Remove `clientContextSchema` from constructor options
  - Remove `clientContext` from ClientOptions
  - Remove `updateClientContext()` from useReStale return type

- **docs/client.md**:
  - Remove `clientContext` from client options
  - Remove `updateClientContext()` from API reference
  - Remove "Infinite Scroll & useInfiniteQuery" section that uses clientContext
  - Update examples to remove clientContext usage

- **docs/server.md**:
  - Remove "Client context for personalized data pushes" section
  - Remove `clientContextSchema` from constructor options table
  - Remove `updateClientContext()` and `getClientContext()` from API documentation
  - Remove examples showing client context usage

### 5. Example Code Updates
- Update all example backends (express, fastify, hono, node):
  - Remove clientContext handling
  - Remove optimisticData from broadcast calls
  - Simplify to invalidation-only signals

- Update frontend examples (react-query):
  - Remove clientContext from useReStale calls
  - Remove optimisticData handling
  - Show simple invalidation pattern

### 6. Test Updates
- Remove or update tests that verify:
  - optimisticData serialization
  - clientContext sync behavior
  - contextual broadcast functionality
  - BroadcastContextualOptions behavior
- Keep tests for:
  - Simple broadcast(signal)
  - Predicate-based broadcast
  - broadcastToAll
  - broadcastByKey
  - Topic-based publish

## What to Keep

### Keep All Simple Invalidation Methods:
- `broadcast(signal: TSignal | TSignal[])`
- `broadcast(signal: TSignal | TSignal[], predicate?: (meta: TMeta | undefined) => boolean)`
- `broadcastToAll(signal: TSignal | TSignal[])`
- `broadcastByKey(signal: TSignal)`
- `publish(topic: string, signal: TSignal | TSignal[])`

### Keep Core Signal Actions:
- TanStack Query: `action: 'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel'`
- SWR: `action: 'revalidate' | 'purge' | 'remove' | 'mutate'`
- Generic: `action: 'invalidate' | 'refetch' | 'remove'`

### Keep Connection Metadata:
- `TMeta` type parameter and `meta` on connections (for authorization)
- `metaSchema` validation
- `predicate: (meta: TMeta | undefined) => boolean` filtering

### Keep PubSub Infrastructure:
- Topic-based publish/subscribe
- Control frames for revokeWhere, revokeByConnectionId
- Multi-server cluster support for simple broadcasts

## Type Parameter Changes

**Before:**
```typescript
SSEChannelGroup<TSignal, TMeta, TTarget, TClientContext>
```

**After:**
```typescript
SSEChannelGroup<TSignal, TMeta, TTarget>
```

## Validation

After removing features:
1. Run `npm run lint` - should pass
2. Run `npm test` - all tests should pass
3. Verify examples still compile
4. Check that simple broadcast operations work:
   ```typescript
   await group.broadcast({ queryKey: ['products'] })
   await group.broadcast({ queryKey: ['products'] }, (meta) => meta.userId === '123')
   await group.broadcastToAll({ queryKey: ['products'] })
   ```

## Rationale

The optimisticData push and clientContext features added significant complexity:
- Required serializing functions across cluster nodes (impossible with inline functions)
- Forced users to configure global handlers OR register named handlers
- Created confusion between local-only and cluster-wide behavior
- Poor developer experience for a feature that's rarely needed

Simple invalidation + client-side refetch is:
- Simpler to understand and use
- Works cluster-wide out of the box
- Leverages existing query client caching and deduplication
- Standard pattern used by most real-time systems

## Success Criteria

After completion:
- ✅ No references to `optimisticData` in code or docs
- ✅ No references to `clientContext` in code or docs  
- ✅ No `BroadcastContextualOptions` interface
- ✅ `SSEChannelGroup` has 3 type parameters (not 4)
- ✅ All tests pass
- ✅ Documentation reflects invalidation-only API
- ✅ Examples show simple invalidation patterns
- ✅ Lint passes with no errors
