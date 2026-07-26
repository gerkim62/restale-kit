# Type Safety Audit & Backlog Findings Report

## Executive Summary
This findings report presents the complete audit backlog of type safety gaps surfaced during the test-only pass of `restale-kit`.
All identified gaps have been encoded into the permanent `.test-d.ts` suite as rigorous type assertions and `@ts-expect-error` directives of what 100% type-safety requires.
Running `pnpm run test:types` (`vitest run --typecheck`) surfaces **7 failing type test blocks (11 total failed type assertions)** representing confirmed gaps where the current types under `src/` are looser than the runtime contract.

---

## Part 0: Entrypoint & Subpath Export Gaps (Reported, Not Type-Test Findings)

### 0.1 Transport Adapters Excluded from Public Exports
- **Severity:** High (Packaging / Export Surface Issue)
- **Files Involved:** `package.json` (`exports`), `src/server/core/index.ts`, `src/server/{node,express,fastify,fetch,hono}/`
- **Issue:** Transport adapters (`attachSSE`, `toSSEResponse`, etc.) implemented in `src/server/{node,express,fastify,fetch,hono}/` are NOT re-exported in `src/server/core/index.ts` nor exposed via `package.json` `exports`.
- **Impact:** Consumers cannot import transport adapters via standard subpaths.
- **Action:** Reported as a packaging gap. Left untouched per test-only constraints.

### 0.2 `createSSEChannel` Missing from `./server` Barrel
- **Severity:** Medium (Export Path Inconsistency)
- **Files Involved:** `src/server/core/index.ts`, `src/testing/index.ts`
- **Issue:** `createSSEChannel` is re-exported from `restale-kit/testing` (`src/testing/index.ts`), but only `SSEChannel` and `SSEChannelOptions` type interfaces are exported from `restale-kit/server` (`src/server/core/index.ts`).
- **Impact:** Consumers attempting to instantiate a channel directly via `restale-kit/server` must import from `restale-kit/testing` instead.

---

## Part 1: Sorted Backlog of Type Safety Gaps

The following items are ordered by severity (Silent Wrong-Target Acceptance > Missing Required Fields > Loose Inference & Structural Escapes).

| ID | Gap / Misuse Allowed | Current Type Signature | Location & Proving Test | Recommended Fix |
| :--- | :--- | :--- | :--- | :--- |
| **#1.1** | **Silent Wrong-Target Signal Acceptance on Channel**<br>`SSEChannel.invalidate()` accepts mismatched signal shapes (e.g. `SSEChannel<TanStackQuerySignal>` accepts `SWRSignal`) without compile error. | `invalidate(signal: TSignal \| TSignal[] \| InvalidateSignal \| InvalidateSignal[], customId?: string): string` | `src/server/core/channel.ts:118`<br>Test: [channel.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel.test-d.ts#L13) | Narrow `invalidate()` parameter signature to `TSignal \| TSignal[]` (or target-aware input type). |
| **#1.2a** | **Silent Un-Targeted Signal Acceptance on Multi-Target Channels & Groups**<br>Multi-target channels (`target: ['swr', 'tanstack-query']`) and groups accept signals missing explicit `target` fields (e.g. `{ key: ['users'] }` without `target`). | Parameter accepts union including `GenericInvalidateSignal` where `target?: 'generic'` is optional. | `src/server/core/channel.ts:118`<br>Tests: [channel.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel.test-d.ts#L32), [channel-group.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel-group.test-d.ts#L56) | Wire `SignalInputForTarget<TTarget>` into channel invalidate and group broadcast parameters to require explicit `target` when target array is configured. |
| **#1.2b** | **Silent Undeclared-Target Signal Acceptance on Multi-Target Channels**<br>Multi-target channel declared with `['swr', 'tanstack-query']` accepts an undeclared target signal (e.g. `{ target: 'rtk-query', tags: ['a'] }`) without compile error. | Parameter accepts wide `InvalidateSignal` union rather than being constrained to target array union. | `src/server/core/channel.ts:118`<br>Test: [channel.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel.test-d.ts#L44) | Constrain multi-target channel signal inputs to `SignalInputForTarget<TTarget>`. |
| **#1.3a** | **Missing Target -> Signal-Type Inference on `createSSEChannel` & `SSEChannelGroup`**<br>`createSSEChannel({ target: 'swr' })` and `new SSEChannelGroup({ target: 'swr' })` without explicit generic return `SSEChannel<InvalidateSignal>` / `SSEChannelGroup<InvalidateSignal>` instead of `SSEChannel<SWRSignal>` / `SSEChannelGroup<SWRSignal>`. | `createSSEChannel<TSignal = InvalidateSignal>(options: SSEChannelOptions)` | `src/server/core/channel.ts:153`<br>Tests: [channel.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel.test-d.ts#L50), [channel-group.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel-group.test-d.ts#L40) | Add overload or generic parameter mapping `target` option string/array to concrete signal union type. |
| **#1.3b** | **Mismatched Generic vs Target Accepted on `createSSEChannel` & `SSEChannelGroup`**<br>`createSSEChannel<SWRSignal>({ target: 'tanstack-query' })` and `new SSEChannelGroup<SWRSignal>({ target: 'tanstack-query' })` (mismatched type argument vs runtime target option) compile cleanly. | `createSSEChannel<TSignal...>(options: SSEChannelOptions)` | `src/server/core/channel.ts:153`<br>Tests: [channel.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel.test-d.ts#L60), [channel-group.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel-group.test-d.ts#L46) | Constrain generic type argument `TSignal` to match `options.target`. |
| **#1.4** | **`options.target` Optional in Type, Required at Runtime**<br>`createSSEChannel({})` (omitting `target`) compiles without type error, but throws an exception at runtime (`target is required`). | `export interface SSEChannelOptions { target?: SignalTarget \| SignalTarget[]; ... }` | `src/server/core/channel.ts:27`<br>Test: [channel.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel.test-d.ts#L65) | Separate direct `createSSEChannel` options (where `target` is required) from group `ChannelSetupOptions` (where `target` can be defaulted by `channelDefaults`). |
| **#1.5** | **`useReStale` Explicit Target Mismatch Compiles Cleanly**<br>`useReStale('/api/sse', { onInvalidate: swrCallback, target: 'tanstack-query' })` compiles cleanly because `TTarget` generic widens to union `'swr' \| 'tanstack-query'`. | `export interface UseReStaleOptions<TTarget extends SignalTarget...> { target?: TTarget; onInvalidate: AdaptedInvalidateCallback<TTarget...>; }` | `src/client/react/useReStale.ts:37`<br>Test: [useReStale.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/client/react/useReStale.test-d.ts#L20) | Constrain `target` parameter type to exact match with `onInvalidate.__restaleTarget` brand. |
| **#1.6** | **Bare Object Literal Shape Laundering via `GenericInvalidateSignal`**<br>Any bare object `{ key: ['users'] }` (without target) is treated as `GenericInvalidateSignal` and passed to `InvalidateSignal` parameters across pubsub and event store APIs. | `export interface GenericInvalidateSignal { target?: 'generic'; key: JSONValue[]; ... }` | `src/types/protocol.ts:53`<br>Test: [protocol.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/types/protocol.test-d.ts) | Require `target` or tighten `GenericInvalidateSignal` discriminant. |
| **#1.7** | **Structural Typing Allows Unvalidated Brand Simulation**<br>Passing `Object.assign((s) => {}, { __restaleTarget: 'swr' })` to `useReStale` bypasses `makeAdaptedCallback` validation due to TypeScript structural typing of `__restaleTarget`. | `export type AdaptedInvalidateCallback<TTarget...> = ((...) => void) & { readonly __restaleTarget: TTarget }` | `src/client/core/client-contracts.ts:13`<br>Test: [useReStale.test-d.ts](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/client/react/useReStale.test-d.ts) | Documented structural typing limitation. Consider unique symbol brand for nominal enforcement in future. |

---

## Summary Statistics & Test Execution

- **Added npm Script:** `"test:types": "vitest run --typecheck"` in `package.json`
- **Total `.test-d.ts` Test Files:** 12 files
- **Total Type Tests Executed:** 582 tests
- **`pnpm run test:types` Outcome:** **FAIL (RED)** as expected, surfacing 7 failing test blocks (11 failing type assertions) corresponding to confirmed API type safety gaps.
