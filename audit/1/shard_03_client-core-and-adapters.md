# Audit Shard 03: Client Core & Adapters

## Scope
- Spec: `spec/sse-query-invalidate-contract.md` (Sections: Client side, `restale-kit/client`, `restale-kit/react`, `restale-kit/tanstack-query`)
- Docs: `docs/client.md`, `docs/api-reference.md`, `README.md`, `restale-kit/README.md`
- Code:
  - `restale-kit/src/client/core/sse-client.ts`
  - `restale-kit/src/client/core/validation.ts`
  - `restale-kit/src/client/core/backoff.ts`
  - `restale-kit/src/client/core/client-contracts.ts`
  - `restale-kit/src/client/react/useReStale.ts`
  - `restale-kit/src/client/swr/adapter.ts`
  - `restale-kit/src/client/tanstack-query/adapter.ts`
- Tests:
  - `restale-kit/src/client/core/sse-client.test.ts`
  - `restale-kit/src/client/core/validation.test.ts`
  - `restale-kit/src/client/core/backoff.test.ts`
  - `restale-kit/src/client/react/useReStale.test.ts`
  - `restale-kit/src/client/swr/adapter.test.ts`
  - `restale-kit/src/client/tanstack-query/adapter.test.ts`

---

## Discrepancies

### [DISC-03-01] TanStack Query adapter expanded actions (`reset`, `cancel`) and filters (`type`, `stale`) missing from Spec and Client Guide
- **Area:** `spec/sse-query-invalidate-contract.md:L683-L705`, `docs/client.md:L262-L269`, `restale-kit/src/client/tanstack-query/adapter.ts:L43-L65`
- **Type:** outdated-doc
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md:L690-L701`:
    Shows `tanstackAdapter` supporting only `invalidate`, `refetch`, and `remove`.
  - `docs/client.md:L262-L269`:
    Lists only `'invalidate'`, `'refetch'`, `'remove'` in the action mapping table.
  - `restale-kit/src/client/tanstack-query/adapter.ts:L43-L65`:
    ```ts
    switch (action) {
      case 'remove': queryClient.removeQueries(filters); break
      case 'reset': void queryClient.resetQueries(filters); break
      case 'cancel': void queryClient.cancelQueries(filters); break
      case 'refetch': void queryClient.refetchQueries(filters); break
      case 'invalidate': default: ...
    }
    ```
- **Discrepancy:** `tanstackQueryAdapter` in `adapter.ts` supports `reset` and `cancel` actions, as well as `type` ('active'|'inactive'|'all') and `stale` (maps to `refetchType`). `spec/sse-query-invalidate-contract.md` and `docs/client.md` only document `invalidate`, `refetch`, and `remove`.
- **Which source is correct / should be trusted:** Implementation (`adapter.ts`). Native TanStack Query signal support was expanded to support full QueryClient operation primitives over SSE.
- **Recommended fix:** Update `spec/sse-query-invalidate-contract.md` and `docs/client.md` to document `reset`, `cancel`, `type`, and `stale` in `tanstackQueryAdapter`.
- **Severity:** medium
- **Confidence:** high

### [DISC-03-02] SWR adapter native actions (`revalidate`, `purge`) and options missing from Spec and incomplete in Client Guide
- **Area:** `spec/sse-query-invalidate-contract.md:L515`, `docs/client.md:L315-L321`, `restale-kit/src/client/swr/adapter.ts:L47-L49`
- **Type:** outdated-doc
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md`: Spec contains no description of `swrAdapter` implementation details.
  - `docs/client.md:L315-L321`:
    Documents action mapping for `'invalidate'`, `'refetch'`, `'remove'`.
  - `restale-kit/src/client/swr/adapter.ts:L47-L49`:
    Supports native SWRSignal actions `revalidate` and `purge`, `revalidate: false`, `match: 'exact' | 'prefix'`, and scalar string or array keys.
- **Discrepancy:** The contract spec omits SWR adapter specification entirely. `docs/client.md` maps generic actions but omits SWR-specific native signal fields (`revalidate`, `purge`, `match`, `revalidate: false`).
- **Which source is correct / should be trusted:** Implementation (`swr/adapter.ts`).
- **Recommended fix:** Add SWR adapter details to `spec/sse-query-invalidate-contract.md` and update `docs/client.md` table to list native `SWRSignal` actions.
- **Severity:** medium
- **Confidence:** high

### [DISC-03-03] Client-side terminal revocation (`onRevoke`, `status: 'closed', reason: 'revoked'`) missing from Spec
- **Area:** `spec/sse-query-invalidate-contract.md:L522-L526`, `docs/client.md:L95-L113`, `restale-kit/src/client/core/sse-client.ts:L317-L348`
- **Type:** spec-not-implemented
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md:L522-L526`:
    ```ts
    type ConnectionStatus =
      | { status: 'connecting' }
      | { status: 'open' }
      | { status: 'closed'; reason: 'manual' | 'unmount' }
      | { status: 'error'; error: Event }
    ```
  - `restale-kit/src/client/core/sse-client.ts:L339-L347`:
    `setStatus({ status: 'closed', reason: 'revoked' })` and dispatches `CustomEvent('revoke', { detail: { reason } })`.
- **Discrepancy:** The specification for `ConnectionStatus` in `spec/sse-query-invalidate-contract.md` only lists `reason: 'manual' | 'unmount'`. It is missing `reason: 'revoked'` and the client `onRevoke` listener behavior.
- **Which source is correct / should be trusted:** Implementation and `docs/client.md`.
- **Recommended fix:** Update `spec/sse-query-invalidate-contract.md` to add `reason: 'revoked'` to `ConnectionStatus` and describe `onRevoke` client revocation handling.
- **Severity:** medium
- **Confidence:** high

---

## Verified Correct Behavior (Agreements)
- Reconnection backoff calculation with exponential delay, max delay cap, jitter (0.5 to 1.5 multiplier), and retry count handling matches across `backoff.ts`, `backoff.test.ts`, spec, and docs.
- `useReStale` utilizes `useSyncExternalStore` with reference-stable status snapshots and proper SSR fallback (`{ status: 'closed', reason: 'unmount' }`).
- Client payload validation pipeline (JSON parsing, structural validation, optional Standard Schema validation, error event emission on invalid payload) is fully covered by `validation.test.ts` and `sse-client.test.ts`.
- Direct manual `close()` and `closeWithUnmount()` cancel pending backoff timers and update status appropriately.
