# Audit 3 Shard 04: Client Core, Backoff, Validation, React, SWR, TanStack Query Integration

## Reviewed Sources
- `restale-kit/src/client/core/backoff.ts`
- `restale-kit/src/client/core/backoff.test.ts`
- `restale-kit/src/client/core/client-contracts.ts`
- `restale-kit/src/client/core/index.ts`
- `restale-kit/src/client/core/sse-client.ts`
- `restale-kit/src/client/core/sse-client.test.ts`
- `restale-kit/src/client/core/validation.ts`
- `restale-kit/src/client/core/validation.test.ts`
- `restale-kit/src/client/react/index.ts`
- `restale-kit/src/client/react/useReStale.ts`
- `restale-kit/src/client/react/useReStale.test.ts`
- `restale-kit/src/client/swr/index.ts`
- `restale-kit/src/client/swr/adapter.ts`
- `restale-kit/src/client/swr/adapter.test.ts`
- `restale-kit/src/client/tanstack-query/index.ts`
- `restale-kit/src/client/tanstack-query/adapter.ts`
- `restale-kit/src/client/tanstack-query/adapter.test.ts`

---

### [AUDIT3-04-01] Agreement Check: Client SSE Core, Backoff, Structural Validation, React Hook & Adapters
- **Area:** `restale-kit/src/client/**/*`
- **Type:** agreement
- **Evidence:**
  - `sse-client.ts`: `SSEInvalidatorClient` generates UUID `connectionId`, appends `__restale_cid__` to URL, tracks `lastEventId`, manages auto-reconnect backoff timers, handles terminal `revoke` events by setting `{ status: 'closed', reason: 'revoked' }`, and integrates optional Standard Schema validation.
  - `backoff.ts`: Exponential backoff with jitter calculation (`baseDelayMs`, `maxDelayMs`).
  - `validation.ts`: Performs 8-step structural validation pipeline for target-discriminated signals (`tanstack-query`, `swr`, `rtk-query`, `generic`).
  - `useReStale.ts`: Uses `useSyncExternalStore` for React subscription, defers client swap in Concurrent Mode via `pendingClientRef`, wires `onInvalidate` and `onRevoke` refs, calls `closeWithUnmount()` on unmount.
  - `tanstackQueryAdapter` & `swrAdapter`: Correctly filter target discriminators, map actions (`invalidate`, `refetch`, `reset`, `remove`, `cancel`, `purge`, `revalidate`), and support memoized hook variants (`useTanstackQueryAdapter`, `useSwrAdapter`).
- **Discrepancy:** None. Implementation, tests, and documentation are fully consistent.
- **Which source is correct / should be trusted:** Implementation.
- **Recommended fix:** No action required.
- **Severity:** low
- **Confidence:** high
