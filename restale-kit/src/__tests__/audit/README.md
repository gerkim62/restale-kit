# Audit Test Suite

This directory contains regression coverage for 13 API contract gaps identified during an earlier audit.

## Test Files Overview

### Gap 1: Target-specific wire frames not client-round-trippable
- **File**: `gap-01-target-wire-roundtrip.test.ts`
- **Issue**: Channel framing removes `target` from signals, but client validator uses `target` to choose validation logic
- **Impact**: Well-typed server calls produce payloads the client rejects

### Gap 2: Multi-target channels accept incomplete batches
- **Files**: `gap-02-multi-target-incomplete-batches.test.ts`
- **Issue**: `SignalInputForTarget` allows any one member of configured-target union, but runtime requires all targets
- **Impact**: Code compiles but throws at runtime

### Gap 3: Target configuration admits arbitrary strings via arrays
- **Files**: `gap-03-arbitrary-target-strings.test.ts`
- **Issue**: `SSEChannelOptions.target` uses `string[]`, accepting unknown target literals in arrays
- **Impact**: Creates channels with targets no client adapter can handle

### Gap 4: Single-target API types conflict with runtime
- **Files**: `gap-04-single-target-type-runtime-mismatch.test.ts`
- **Issue**: Runtime auto-fills missing signal target, but types require it
- **Impact**: Documented behavior doesn't match type contract

### Gap 5: Channel/group transport setup can override typed target
- **Files**: 
  - `gap-05-transport-target-override.test.ts` (runtime)
  - `gap-05-transport-setup-target-override.test-d.ts` (type-only)
- **Issue**: `ChannelSetupOptions` independent of group's `TSignal`/`TTarget`
- **Impact**: SWR group can create TanStack channel, returned as wrong type

### Gap 6: Structural assignability across incompatible signal types
- **Files**:
  - `gap-06-structural-assignability.test.ts` (runtime)
  - `gap-06-structural-assignability.test-d.ts` (type-only)
- **Issue**: Mutating APIs are interface methods with bivariant parameters
- **Impact**: `SSEChannel<TanStackQuerySignal>` can enter SWR group without cast

### Gap 7: beforeFrame loses the inferred signal type
- **Files**:
  - `gap-07-beforeframe-signal-type.test.ts` (runtime)
  - `gap-07-beforeframe-signal-type.test-d.ts` (type-only)
- **Issue**: `beforeFrame` always typed as `BeforeFrameFn<InvalidateSignal>`
- **Impact**: SWR channel guard receives entire signal union instead of SWR-specific types

### Gap 8: Adapter generics not tied to adapter target
- **Files**:
  - `gap-08-adapter-generic-mismatch.test.ts` (runtime)
  - `gap-08-adapter-generic-mismatch.test-d.ts` (type-only)
- **Issue**: `tanstackQueryAdapter` and `swrAdapter` accept any `TSignal extends InvalidateSignal`
- **Impact**: `tanstackQueryAdapter<SWRSignal>()` compiles but is meaningless

### Gap 9: Client target and event-payload type can contradict
- **Files**:
  - `gap-09-client-target-signal-mismatch.test.ts` (runtime)
  - `gap-09-client-target-signal-mismatch.test-d.ts` (type-only)
- **Issue**: `SSEInvalidatorClient` has independent `TSignal` and `ClientOptions.target`
- **Impact**: `new SSEInvalidatorClient<SWRSignal>(url, { target: 'tanstack-query' })` compiles

### Gap 10: String inputs too broad for runtime invariants
- **File**: `gap-10-string-input-validation.test.ts`
- **Issue**: Topics, connection IDs, and other strings are plain `string` despite runtime rejecting blank/whitespace
- **Impact**: Invalid strings accepted by type system but fail at runtime

### Gap 11: Numeric inputs unrestricted despite bounded constraints
- **File**: `gap-11-numeric-input-validation.test.ts`
- **Issue**: Capacity, intervals, retries, HTTP status ranges are plain `number`
- **Impact**: Negative, fractional, NaN, Infinity values accepted but produce nonsensical behavior

### Gap 12: JSONValue includes non-serializable numbers
- **File**: `gap-12-jsonvalue-serialization.test.ts`
- **Issue**: `JSONValue` includes `number`, accepting NaN/Infinity which serialize to `null`
- **Impact**: Keys and RTK IDs can contain values that don't survive JSON round-trip

### Gap 13: Two incompatible RevokeEventDetail shapes
- **Files**:
  - `gap-13-revoke-event-detail-conflict.test.ts` (runtime)
  - `gap-13-revoke-event-detail-conflict.test-d.ts` (type-only)
- **Issue**: Root export and client export have different `RevokeEventDetail` shapes
- **Impact**: Same type name represents different contracts depending on import source

## Running the Tests

### Run all audit tests
```bash
npm test -- src/__tests__/audit
```

### Run specific gap tests
```bash
npm test -- src/__tests__/audit/gap-01
```

### Run type-only tests
```bash
npm run test:types -- src/__tests__/audit
```

## Expected Behavior

**These tests are expected to pass.** They document the corrected behavior and guard against regressions in the associated runtime and type-level contracts.

## Test Organization

- `.test.ts` files: Runtime behavior tests using vitest
- `.test-d.ts` files: Type-only tests (where applicable) for compile-time validation

## Maintaining the Regression Coverage

Each test file contains detailed comments describing the original gap, the required behavior, and relevant edge cases.

Use these tests as acceptance criteria when implementing fixes.
