# ReStale Kit Codebase Audit Summary

## Executive Summary

- **What to Trust:** The implementation in `restale-kit/src/**` is complete, thoroughly tested, and highly stable. All unit, integration, end-to-end transport, and security regression tests are passing.
- **What to Edit (Documentation, Examples & Specs):** The primary specifications in `spec/`, user guides in `docs/`, `CHANGELOG.md`, `vitest-testing-plan.md`, and example applications in `examples/` have drifted behind recent code additions — specifically: target-discriminated signals (`ReStaleSignal`), PubSub AES-256-GCM encryption with AAD binding, expanded TanStack/SWR adapter actions, terminal connection revocation, and redundant `req.once('close')` listeners in examples.
- **What to Build / Clarify:** Clarify in `spec/sse-query-invalidate-contract.md` that `eventStore` must be explicitly passed into both `SSEChannelGroup` and transport adapters (`attachSSE`/`toSSEResponse`) for reconnection replay to operate correctly.

---

## Discrepancies Grouped by Severity

### High Severity

1. **[DISC-01-01] Wire signal type expansion (discriminated union) not documented in Spec or API Reference**
   - **Type:** outdated-doc
   - **Discrepancy:** Spec and API Reference describe `InvalidateSignal` as a single generic `{ key, exact, action }` object, omitting target-discriminated signals (`tanstack-query`, `swr`, `rtk-query`, `generic`).
   - **Fix:** Update `spec/sse-query-invalidate-contract.md` and `docs/api-reference.md` to document `ReStaleSignal` and target payloads.
   - **Details:** See [audit/1/shard_01_protocol-and-types.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_01_protocol-and-types.md)

2. **[DISC-04-01] Encryption specification (`PubSubEncryptionOptions`, AES-256-GCM, AAD binding) missing from PubSub Spec**
   - **Type:** spec-not-implemented
   - **Discrepancy:** `spec/pubsub-adapter-contract.md` does not specify mandatory encryption options (`encrypt: false` vs `encryptionKey: string`), AES-256-GCM cipher payload format, or topic AAD binding.
   - **Fix:** Update `spec/pubsub-adapter-contract.md` to reflect the PubSub security contract.
   - **Details:** See [audit/1/shard_04_pubsub-adapters.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_04_pubsub-adapters.md)

---

### Medium Severity

3. **[DISC-01-02] Omission of exported protocol/schema utility functions in API Reference and Spec**
   - **Type:** outdated-doc
   - **Discrepancy:** `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, `SIGNAL_TARGETS`, and `validateStandardSchema` are exported from `restale-kit` root but missing from `docs/api-reference.md` and `spec/`.
   - **Fix:** Add utility exports to `docs/api-reference.md` and `spec/sse-query-invalidate-contract.md`.
   - **Details:** See [audit/1/shard_01_protocol-and-types.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_01_protocol-and-types.md)

4. **[DISC-02-01] `SSEChannel.revoke(reason)` missing from Spec interface definition**
   - **Type:** spec-not-implemented
   - **Discrepancy:** `revoke(reason?: string): void` is implemented on `SSEChannel` and documented in `docs/api-reference.md`, but absent from `interface SSEChannel` in `spec/sse-query-invalidate-contract.md`.
   - **Fix:** Add `revoke` to `interface SSEChannel` in `spec/sse-query-invalidate-contract.md`.
   - **Details:** See [audit/1/shard_02_server-core-and-adapters.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_02_server-core-and-adapters.md)

5. **[DISC-02-02] `eventBufferCapacity` set on `SSEChannelGroup` does not automatically attach event store to registered channels**
   - **Type:** implementation-drift
   - **Discrepancy:** Setting `eventBufferCapacity` on `SSEChannelGroup` creates a group event store, but channels created via `attachSSE`/`toSSEResponse` must also explicitly receive `eventStore` in options to support replay on reconnect.
   - **Fix:** Clarify explicit `eventStore` sharing in `spec/sse-query-invalidate-contract.md`.
   - **Details:** See [audit/1/shard_02_server-core-and-adapters.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_02_server-core-and-adapters.md)

6. **[DISC-03-01] TanStack Query adapter expanded actions (`reset`, `cancel`) and filters (`type`, `stale`) missing from Spec and Client Guide**
   - **Type:** outdated-doc
   - **Discrepancy:** `tanstackQueryAdapter` supports `reset`, `cancel`, `type`, and `stale`, but `spec/` and `docs/client.md` only document `invalidate`, `refetch`, and `remove`.
   - **Fix:** Update `spec/sse-query-invalidate-contract.md` and `docs/client.md`.
   - **Details:** See [audit/1/shard_03_client-core-and-adapters.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_03_client-core-and-adapters.md)

7. **[DISC-03-02] SWR adapter native actions (`revalidate`, `purge`) and options missing from Spec and incomplete in Client Guide**
   - **Type:** outdated-doc
   - **Discrepancy:** Native `SWRSignal` actions (`revalidate`, `purge`), `revalidate: false`, and `match` options are implemented in `swrAdapter` but missing from `spec/` and `docs/client.md`.
   - **Fix:** Document SWR adapter features in `spec/sse-query-invalidate-contract.md` and `docs/client.md`.
   - **Details:** See [audit/1/shard_03_client-core-and-adapters.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_03_client-core-and-adapters.md)

8. **[DISC-03-03] Client-side terminal revocation (`onRevoke`, `status: 'closed', reason: 'revoked'`) missing from Spec**
   - **Type:** spec-not-implemented
   - **Discrepancy:** Spec lists `reason: 'manual' | 'unmount'` for `ConnectionStatus`, missing `reason: 'revoked'` and `onRevoke` listener behavior.
   - **Fix:** Update `spec/sse-query-invalidate-contract.md` with `reason: 'revoked'` and `onRevoke`.
   - **Details:** See [audit/1/shard_03_client-core-and-adapters.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_03_client-core-and-adapters.md)

9. **[DISC-07-01] `vitest-testing-plan.md` describes obsolete event store replay behavior superseded by Issue 4 security fix**
   - **Type:** outdated-doc
   - **Discrepancy:** `vitest-testing-plan.md` states `getEventsAfter` returns all current records for missing/evicted IDs. Implementation returns `stale: true` and empty events to trigger full-invalidation frame `{ key: [] }`.
   - **Fix:** Update `vitest-testing-plan.md` to match current security fix behavior.
   - **Details:** See [audit/1/shard_07_package-manifest-and-meta-specs.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_07_package-manifest-and-meta-specs.md)

---

### Low Severity

10. **[DISC-01-03] Undocumented asymmetry in `matchesInvalidateSignalKey` for scalar string cache keys**
    - **Type:** undocumented-behavior
    - **Details:** See [audit/1/shard_01_protocol-and-types.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_01_protocol-and-types.md)

11. **[DISC-02-03] `broadcastByKey` auto-wraps scalar and object metadata into arrays for key matching without spec documentation**
    - **Type:** undocumented-behavior
    - **Details:** See [audit/1/shard_02_server-core-and-adapters.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_02_server-core-and-adapters.md)

12. **[DISC-04-02] Omission of `PubSubDecryptionError` and `PubSubEncryptionOptions` in API Reference for `restale-kit/pubsub`**
    - **Type:** outdated-doc
    - **Details:** See [audit/1/shard_04_pubsub-adapters.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_04_pubsub-adapters.md)

13. **[DISC-05-01] Undocumented 512-byte length limit on `Last-Event-ID` header**
    - **Type:** undocumented-behavior
    - **Details:** See [audit/1/shard_05_revocation-and-security.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_05_revocation-and-security.md)

14. **[DISC-05-02] `controlTopic` non-empty string validation unmentioned in contract spec**
    - **Type:** undocumented-behavior
    - **Details:** See [audit/1/shard_05_revocation-and-security.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_05_revocation-and-security.md)

15. **[DISC-05-03] Connection Revocation Spec remains marked as a draft**
    - **Type:** outdated-doc
    - **Details:** See [audit/1/shard_05_revocation-and-security.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_05_revocation-and-security.md)

16. **[DISC-06-01] Redundant manual connection cleanup in Vercel Redis example conflicting with server guide**
    - **Type:** contradiction
    - **Details:** See [audit/1/shard_06_examples-and-scripts.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_06_examples-and-scripts.md)

17. **[DISC-06-02] Fastify example using manual optional chaining on `meta` in predicate instead of typed metadata**
    - **Type:** contradiction
    - **Details:** See [audit/1/shard_06_examples-and-scripts.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_06_examples-and-scripts.md)

18. **[DISC-07-02] CHANGELOG.md missing v0.2.0 entries for target-discriminated signals and scalar key matching**
    - **Type:** outdated-doc
    - **Details:** See [audit/1/shard_07_package-manifest-and-meta-specs.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_07_package-manifest-and-meta-specs.md)

19. **[DISC-07-03] `spec/folder-structure.md` missing `src/utils/` and `src/test-fixtures/` directories**
    - **Type:** outdated-doc
    - **Details:** See [audit/1/shard_07_package-manifest-and-meta-specs.md](file:///home/gerison/coding/experiments/sse-query-invalidator/audit/1/shard_07_package-manifest-and-meta-specs.md)
