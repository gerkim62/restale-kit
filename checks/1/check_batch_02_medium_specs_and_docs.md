# Fix Check Batch 02: Medium Severity Findings

## Re-Verification Entries

### [DISC-01-02] Omission of exported protocol/schema utility functions in API Reference and Spec
- **Fix source:** `fixes/1/batch_02_medium_specs_and_docs.md`
- **Original claim:** Documented exported utility functions (`isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, `SIGNAL_TARGETS`, `validateStandardSchema`) in `docs/api-reference.md` and `spec/sse-query-invalidate-contract.md`.
- **Re-verified change:** `docs/api-reference.md:L9-L18` and `spec/sse-query-invalidate-contract.md:L729-L745` document all five root exports.
- **Discrepancy resolved?** yes
- **Test verification:** Executed `pnpm run test:package` — `scripts/verify-package.mjs` imported all exports successfully.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-02-01] `SSEChannel.revoke(reason)` missing from Spec interface definition
- **Fix source:** `fixes/1/batch_02_medium_specs_and_docs.md`
- **Original claim:** Added `revoke(reason?: string): void` to `interface SSEChannel` in `spec/sse-query-invalidate-contract.md`.
- **Re-verified change:** `spec/sse-query-invalidate-contract.md:L235` now contains `revoke(reason?: string): void`.
- **Discrepancy resolved?** yes
- **Test verification:** `channel.test.ts` unit tests pass.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-02-02] `eventBufferCapacity` set on `SSEChannelGroup` does not automatically attach event store to registered channels
- **Fix source:** `fixes/1/batch_02_medium_specs_and_docs.md`
- **Original claim:** Documented explicit `eventStore` sharing requirement in `spec/sse-query-invalidate-contract.md`.
- **Re-verified change:** `spec/sse-query-invalidate-contract.md:L268-L275` explicitly notes that `eventStore` must be passed to both `SSEChannelGroup` and transport adapters.
- **Discrepancy resolved?** yes
- **Test verification:** `channel-group.test.ts` and `e2e-transport.test.ts` pass.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-03-01] TanStack Query adapter expanded actions (`reset`, `cancel`) and filters (`type`, `stale`) missing from Spec and Client Guide
- **Fix source:** `fixes/1/batch_02_medium_specs_and_docs.md`
- **Original claim:** Documented `reset`, `cancel`, `type`, and `stale` in `spec/sse-query-invalidate-contract.md` and `docs/client.md`.
- **Re-verified change:** `spec/sse-query-invalidate-contract.md:L695-L710` and `docs/client.md:L262-L275` describe expanded TanStack Query primitives.
- **Discrepancy resolved?** yes
- **Test verification:** `tanstack-query/adapter.test.ts` passes.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-03-02] SWR adapter native actions (`revalidate`, `purge`) and options missing from Spec and incomplete in Client Guide
- **Fix source:** `fixes/1/batch_02_medium_specs_and_docs.md`
- **Original claim:** Added SWR adapter section to `spec/sse-query-invalidate-contract.md` and updated `docs/client.md`.
- **Re-verified change:** `spec/sse-query-invalidate-contract.md:L515-L535` and `docs/client.md:L315-L330` document SWR actions and options.
- **Discrepancy resolved?** yes
- **Test verification:** `swr/adapter.test.ts` passes.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-03-03] Client-side terminal revocation (`onRevoke`, `status: 'closed', reason: 'revoked'`) missing from Spec
- **Fix source:** `fixes/1/batch_02_medium_specs_and_docs.md`
- **Original claim:** Documented `reason: 'revoked'` in `ConnectionStatus` and `onRevoke` listener in `spec/sse-query-invalidate-contract.md`.
- **Re-verified change:** `spec/sse-query-invalidate-contract.md:L525-L540` documents terminal revocation state and event handling.
- **Discrepancy resolved?** yes
- **Test verification:** `sse-client.test.ts` passes.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-07-01] `vitest-testing-plan.md` describes obsolete event store replay behavior superseded by Issue 4 security fix
- **Fix source:** `fixes/1/batch_02_medium_specs_and_docs.md`
- **Original claim:** Updated `vitest-testing-plan.md` to reflect `{ events: [], stale: true }` return value for missing/evicted event IDs.
- **Re-verified change:** `vitest-testing-plan.md:L114-L120` updated with accurate `{ events: [], stale: true }` semantics.
- **Discrepancy resolved?** yes
- **Test verification:** `event-store.test.ts` and `security-regression.test.ts` pass.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none
