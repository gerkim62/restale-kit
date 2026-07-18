# Shard: Client Contracts & Protocol Types

## Finding CP-01: Client `target` Option Remains Optional

### Discrepancy Summary
On the client side, `ClientOptions.target` remains optional (`target?: SignalTarget`). When omitted, client adapters (`useSwrAdapter`, `useTanstackQueryAdapter`) set their default target (`"swr"` or `"tanstack-query"`). This aligns with the rule: *"client doesnt need to pass it, but the server must declare what clients it does support"*.

### Four Sources

#### Spec
- [`spec/sse-query-invalidate-contract.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/spec/sse-query-invalidate-contract.md#L550): Client target is optional; client reads target framing from incoming SSE frames and/or `X-ReStale-Target` header.

#### Docs
- [`docs/client.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/docs/client.md#L45): Documents `target` as an optional property on `ClientOptions`.

#### Implementation
- [`restale-kit/src/client/core/client-contracts.ts:L42`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/client/core/client-contracts.ts#L42): `target?: SignalTarget` is optional in `ClientOptions`.
- [`restale-kit/src/client/swr/adapter.ts:L35`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/client/swr/adapter.ts#L35): `swrAdapter` defaults `target` to `"swr"`.
- [`restale-kit/src/client/tanstack-query/adapter.ts:L30`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/client/tanstack-query/adapter.ts#L30): `tanstackAdapter` defaults `target` to `"tanstack-query"`.

#### Tests
- [`restale-kit/src/client/swr/adapter.test.ts`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/client/swr/adapter.test.ts) & [`tanstack-query/adapter.test.ts`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/client/tanstack-query/adapter.test.ts): Verify clients work out-of-the-box without passing explicit `target` in `useReStale`.

### Source of Truth Verdict
**Correct & Authoritative**: Client `target` is optional and automatically supplied by framework adapters.

### Recommended Fix
No changes needed.

### Severity & Confidence
- **Severity**: Info
- **Confidence**: High
