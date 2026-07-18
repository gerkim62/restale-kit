# Audit Summary Report: Target Refactor Alignment

## What to Trust / What to Edit

- **Settled Source of Truth**: 
  - `target: SignalTarget | SignalTarget[]` is **required on `SSEChannelOptions`** (`createSSEChannel`, `attachSSE`, `toSSEResponse`) because the `SSEChannel` is responsible for setting `X-ReStale-Target` HTTP headers and serializing framed SSE bytes via `channel.invalidate()`.
  - `target` is **removed from `SSEChannelGroupOptions`** because `SSEChannelGroup` is a target-agnostic pubsub router that delivers raw signals to channels without inspecting or transforming targets.
  - `ClientOptions.target` remains **optional** on the client side (`useReStale`, `useSwrAdapter`, `useTanstackQueryAdapter`).

- **What to Edit**:
  1. `restale-kit/src/server/core/channel-group.ts`: Remove `target` from `SSEChannelGroupOptions` and `SSEChannelGroup` class properties. Make `options` optional in `SSEChannelGroup` constructor.
  2. `restale-kit/src/server/core/channel-group.test.ts`: Remove artificial `{ target: 'swr' }` arguments from `new SSEChannelGroup()` calls.
  3. `README.md`, `docs/server.md`, `docs/api-reference.md`, `spec/sse-query-invalidate-contract.md`: Remove `target` from `SSEChannelGroupOptions` documentation and keep `target` required on `SSEChannelOptions` / `attachSSE` / `toSSEResponse`.

---

## Discrepancies Summary

| Finding | Component | Discrepancy Summary | Severity | Status |
| --- | --- | --- | --- | --- |
| **SC-01** | `SSEChannelGroup` | Dead `target` property and artificial requirement on `SSEChannelGroupOptions` | High | Action Required |
| **SC-02** | `SSEChannel` | `target` required on `SSEChannelOptions` and used in `invalidate()` | Info | Verified Correct |
| **SA-01** | Transport Adapters | `attachSSE` & `toSSEResponse` require `target` and set `X-ReStale-Target` header | Info | Verified Correct |
| **CP-01** | Client & Protocol | `ClientOptions.target` optional; client adapters supply default target | Info | Verified Correct |
| **DC-01** | Documentation | Docs and specs list `SSEChannelGroupOptions.target` as required | Medium | Action Required |

---

## Shard Detail Pointers

- See [`shard_server_core.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/target_refactor/shard_server_core.md) for core channel and group findings.
- See [`shard_server_adapters.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/target_refactor/shard_server_adapters.md) for transport adapter findings.
- See [`shard_client_and_protocol.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/target_refactor/shard_client_and_protocol.md) for client contract findings.
- See [`shard_documentation.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/target_refactor/shard_documentation.md) for documentation discrepancies.
