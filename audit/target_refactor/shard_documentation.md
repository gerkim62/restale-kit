# Shard: Documentation & Specifications

## Finding DC-01: Documentation Out of Date Regarding `SSEChannelGroupOptions.target`

### Discrepancy Summary
Current documentation (`docs/server.md`, `docs/api-reference.md`, `README.md`, and `spec/sse-query-invalidate-contract.md`) lists `target: SignalTarget | SignalTarget[]` as a required option on `SSEChannelGroupOptions`. With our settled source of truth (removing `target` from `SSEChannelGroupOptions` because it is unused in delivery), documentation must be updated so `SSEChannelGroupOptions` does NOT mention `target`, while `SSEChannelOptions` (`createSSEChannel`, `attachSSE`, `toSSEResponse`) correctly marks `target` as required.

### Four Sources

#### Spec
- [`spec/sse-query-invalidate-contract.md:L550`](file:///home/gerison/coding/experiments/sse-query-invalidator/spec/sse-query-invalidate-contract.md#L550): Lists `SSEChannelGroupOptions.target` as required.

#### Docs
- [`docs/server.md:L30`](file:///home/gerison/coding/experiments/sse-query-invalidator/docs/server.md#L30): Documents `target` on `SSEChannelGroupOptions`.
- [`docs/api-reference.md:L120`](file:///home/gerison/coding/experiments/sse-query-invalidator/docs/api-reference.md#L120): Lists `target` on `SSEChannelGroupOptions`.
- [`README.md:L80`](file:///home/gerison/coding/experiments/sse-query-invalidator/README.md#L80): Shows `new SSEChannelGroup({ target: ... })`.

#### Implementation
- Pending update: `target` is being removed from `SSEChannelGroupOptions` in `restale-kit/src/server/core/channel-group.ts`.

#### Tests
- Pending update: `channel-group.test.ts` test cases are being updated to remove `target` from `new SSEChannelGroup()`.

### Source of Truth Verdict
**Docs & Tests Out of Date**: Documentation and contract specs must be updated to align with the settled source of truth.

### Recommended Fix
1. Remove `target` from `SSEChannelGroupOptions` tables and examples in `README.md`, `docs/server.md`, `docs/api-reference.md`, and `spec/sse-query-invalidate-contract.md`.
2. Emphasize that `target` is required on `SSEChannelOptions` (`attachSSE`, `toSSEResponse`, `createSSEChannel`).

### Severity & Confidence
- **Severity**: Medium
- **Confidence**: High
