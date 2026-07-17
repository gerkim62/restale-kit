# Audit Shard 04: Client Core, React, SWR, and TanStack Query Integration

### [AUDIT2-04-001] Verified agreement across Client SSE core and framework adapters
- **Area:** `restale-kit/src/client/core/sse-client.ts`, `restale-kit/src/client/core/validation.ts`, `restale-kit/src/client/react/useReStale.ts`, `restale-kit/src/client/swr/adapter.ts`, `restale-kit/src/client/tanstack-query/adapter.ts`, `docs/client.md`
- **Type:** undocumented-behavior
- **Evidence:**
  - `restale-kit/src/client/core/sse-client.ts:317-348`: Handles terminal `revoke` SSE events, sets status reason to `'revoked'`, and suppresses auto-reconnect as specified.
  - `restale-kit/src/client/react/useReStale.ts:153-164`: Automatically closes with reason `'unmount'` on component unmount and opens on mount unless `disabled: true`.
  - `restale-kit/src/client/tanstack-query/adapter.ts:56-64`: Correctly maps `stale: true` to `refetchType: 'none'` and `stale: false` to `refetchType: 'active'`.
  - `restale-kit/src/client/swr/adapter.ts:48-79`: Handles `purge`, `remove`, `revalidate: false`, and `toInvalidateKey` options.
- **Discrepancy:** None — behavior is consistent across spec, docs, tests, and implementation.
- **Which source is correct / should be trusted:** Implementation matches specification and documentation.
- **Recommended fix:** No code changes needed.
- **Severity:** low
- **Confidence:** high
