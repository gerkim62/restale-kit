# Audit Ledger Shard: Client

## Inventory Covered
- `spec/sse-query-invalidate-contract.md` (Client side section)
- `spec/restale-kit-connection-revocation-spec.md` (Client section)
- `docs/client.md`
- `docs/api-reference.md` (`restale-kit/client`, `/react`, `/tanstack-query`, `/swr` sections)
- `restale-kit/src/client/core/sse-client.ts`
- `restale-kit/src/client/core/backoff.ts`
- `restale-kit/src/client/core/client-contracts.ts`
- `restale-kit/src/client/core/validation.ts`
- `restale-kit/src/client/react/useReStale.ts`
- `restale-kit/src/client/swr/adapter.ts`
- `restale-kit/src/client/tanstack-query/adapter.ts`
- `restale-kit/src/client/core/sse-client.test.ts`
- `restale-kit/src/client/core/backoff.test.ts`
- `restale-kit/src/client/core/validation.test.ts`
- `restale-kit/src/client/react/useReStale.test.ts`
- `restale-kit/src/client/swr/adapter.test.ts`
- `restale-kit/src/client/tanstack-query/adapter.test.ts`

---

### [FINDING-005] Agreement verification: Client core, React hook, backoff, validation, and cache adapters
- **Area:** `spec/sse-query-invalidate-contract.md`, `docs/client.md`, `docs/api-reference.md`, `restale-kit/src/client/*`
- **Status:** PASS / Agreed
- **Notes:**
  - `SSEInvalidatorClient`: Appends `__restale_cid__` UUID, manages `EventSource`, status state machine (`connecting`, `open`, `closed` with reasons `manual`/`unmount`/`revoked`, `error`), exponential backoff + jitter, `connect()` re-entrancy and cancellation handling, and terminal `revoke` event handling without auto-reconnect.
  - `useReStale`: React `useSyncExternalStore` integration, options stability, `connectionId` exposing, `disabled` flag handling, and concurrent mode safe client swapping via deferred effect.
  - Payload validation: 8-step pipeline in `validation.ts` + `validateStandardSchema` integration.
  - `tanstackQueryAdapter` & `useTanstackQueryAdapter`: Maps `invalidate`, `refetch`, `reset`, `remove`, `cancel` actions and `queryKey`, `exact`, `type`, `stale` filters to `QueryClient`.
  - `swrAdapter` & `useSwrAdapter`: Maps `revalidate` / `purge` / `remove` actions, `revalidate: false` option, string / array keys, and `toInvalidateKey` option to SWR `mutate`.
