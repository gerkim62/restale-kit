# Verification Shard 03: Client Core & Adapters

## Findings Re-Verification

### [DISC-03-01] TanStack Query adapter expanded actions (`reset`, `cancel`) and filters (`type`, `stale`) missing from Spec and Client Guide
- **Audit claim:** `tanstackQueryAdapter` supports `reset`, `cancel`, `type`, and `stale`, missing from spec and client guide.
- **Re-checked evidence:**
  - `restale-kit/src/client/tanstack-query/adapter.ts:L43-L65`: Switch handles `remove`, `reset`, `cancel`, `refetch`, `invalidate`.
- **Verdict:** confirmed
- **Reasoning:** Implementation features were missing from documentation.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-03-02] SWR adapter native actions (`revalidate`, `purge`) and options missing from Spec and incomplete in Client Guide
- **Audit claim:** Spec omitted SWR adapter section and `docs/client.md` omitted native SWR signal fields (`revalidate`, `purge`, `match`, `revalidate: false`).
- **Re-checked evidence:**
  - `restale-kit/src/client/swr/adapter.ts:L47-L49`: Supports native SWR actions and options.
- **Verdict:** confirmed
- **Reasoning:** SWR adapter was fully implemented in code but under-documented in contract spec and client guide.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-03-03] Client-side terminal revocation (`onRevoke`, `status: 'closed', reason: 'revoked'`) missing from Spec
- **Audit claim:** `ConnectionStatus` in spec omitted `reason: 'revoked'` and `onRevoke` listener handling.
- **Re-checked evidence:**
  - `restale-kit/src/client/core/sse-client.ts:L339-L347`: Dispatches `revoke` event and updates status to `{ status: 'closed', reason: 'revoked' }`.
- **Verdict:** confirmed
- **Reasoning:** Terminal revocation client contract was missing from `sse-query-invalidate-contract.md`.
- **Correction (if any):** None.
- **Confidence:** high
