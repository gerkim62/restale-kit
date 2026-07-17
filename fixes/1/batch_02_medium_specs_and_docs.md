# Fix Batch 02: Medium Severity Findings

### [DISC-01-02] Omission of exported protocol/schema utility functions in API Reference and Spec
- **Audit source:** `audit/1/shard_01_protocol-and-types.md`
- **Triage decision:** fix-now
- **Reasoning:** Public exported functions (`isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, `SIGNAL_TARGETS`, `validateStandardSchema`) belong in the exported API reference and spec.
- **Change made:** Added exported functions and `SIGNAL_TARGETS` to `docs/api-reference.md` and `spec/sse-query-invalidate-contract.md`.
- **Tests:** `restale-kit/src/index-exports.test.ts`
- **Status:** done
- **Follow-ups:** None.

### [DISC-02-01] `SSEChannel.revoke(reason)` missing from Spec interface definition
- **Audit source:** `audit/1/shard_02_server-core-and-adapters.md`
- **Triage decision:** fix-now
- **Reasoning:** `revoke()` is a core channel method implemented on `SSEChannel` and documented in `docs/api-reference.md`.
- **Change made:** Added `revoke(reason?: string): void` to `interface SSEChannel` in `spec/sse-query-invalidate-contract.md`.
- **Tests:** `restale-kit/src/server/core/channel.test.ts`
- **Status:** done
- **Follow-ups:** None.

### [DISC-02-02] `eventBufferCapacity` set on `SSEChannelGroup` does not automatically attach event store to registered channels
- **Audit source:** `audit/1/shard_02_server-core-and-adapters.md`
- **Triage decision:** fix-now
- **Reasoning:** Reconnection replay requires `eventStore` to be explicitly provided to both `SSEChannelGroup` and transport adapters. Clarifying this in the spec prevents user setup confusion.
- **Change made:** Clarified in `spec/sse-query-invalidate-contract.md` that explicit `eventStore` sharing is required across `SSEChannelGroup` and transport options.
- **Tests:** `restale-kit/src/server/core/channel-group.test.ts`
- **Status:** done
- **Follow-ups:** None.

### [DISC-03-01] TanStack Query adapter expanded actions (`reset`, `cancel`) and filters (`type`, `stale`) missing from Spec and Client Guide
- **Audit source:** `audit/1/shard_03_client-core-and-adapters.md`
- **Triage decision:** fix-now
- **Reasoning:** Native `TanStackQuerySignal` support includes `reset`, `cancel`, `type`, and `stale`. Spec and client guide should accurately cover them.
- **Change made:** Updated `spec/sse-query-invalidate-contract.md` and `docs/client.md` to document all TanStack Query actions and filters.
- **Tests:** `restale-kit/src/client/tanstack-query/adapter.test.ts`
- **Status:** done
- **Follow-ups:** None.

### [DISC-03-02] SWR adapter native actions (`revalidate`, `purge`) and options missing from Spec and incomplete in Client Guide
- **Audit source:** `audit/1/shard_03_client-core-and-adapters.md`
- **Triage decision:** fix-now
- **Reasoning:** Native `SWRSignal` support includes `revalidate`, `purge`, `match`, and `revalidate: false`. Spec and client guide should accurately cover them.
- **Change made:** Added `restale-kit/swr` adapter specification section to `spec/sse-query-invalidate-contract.md` and updated `docs/client.md`.
- **Tests:** `restale-kit/src/client/swr/adapter.test.ts`
- **Status:** done
- **Follow-ups:** None.

### [DISC-03-03] Client-side terminal revocation (`onRevoke`, `status: 'closed', reason: 'revoked'`) missing from Spec
- **Audit source:** `audit/1/shard_03_client-core-and-adapters.md`
- **Triage decision:** fix-now
- **Reasoning:** Terminal revocation is a core security feature with client status `'closed'` (`reason: 'revoked'`) and `onRevoke` listener handling.
- **Change made:** Updated `spec/sse-query-invalidate-contract.md` with `reason: 'revoked'` in `ConnectionStatus`, `onRevoke`, and `revoke` event map.
- **Tests:** `restale-kit/src/client/core/sse-client.test.ts`
- **Status:** done
- **Follow-ups:** None.

### [DISC-07-01] `vitest-testing-plan.md` describes obsolete event store replay behavior superseded by Issue 4 security fix
- **Audit source:** `audit/1/shard_07_package-manifest-and-meta-specs.md`
- **Triage decision:** fix-now
- **Reasoning:** `vitest-testing-plan.md` must accurately reflect current security behavior (`stale: true` and empty events on missing/evicted event ID).
- **Change made:** Updated `vitest-testing-plan.md` to document `{ events: [], stale: true }` and full-invalidation frame response.
- **Tests:** `restale-kit/src/security-regression.test.ts`
- **Status:** done
- **Follow-ups:** None.

