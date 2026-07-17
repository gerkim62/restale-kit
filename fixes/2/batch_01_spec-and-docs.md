# Fix Batch 01: Core Spec and Documentation Updates

### [AUDIT2-01-001] Contradiction on StandardSchemaV1 export claim in spec vs index exports
- **Audit source:** `shard_01_spec-and-docs.md`
- **Triage decision:** fix-now
- **Reasoning:** Re-exporting `StandardSchemaV1` from root index is intentional and useful for consumers. The spec and API reference should accurately document this export.
- **Change made:**
  - `spec/sse-query-invalidate-contract.md`: Updated `StandardSchemaV1` description to reflect that it is re-exported as a type-only export from `restale-kit`. Added `StandardSchemaV1` to the subpath exports table.
  - `docs/api-reference.md`: Added `StandardSchemaV1` to the root `restale-kit` type exports list.
- **Tests:** `pnpm run test:package` — passed cleanly.
- **Status:** done
- **Follow-ups:** None.

---

### [AUDIT2-01-002] Documentation uses `StandardSchema` instead of `StandardSchemaV1`
- **Audit source:** `shard_01_spec-and-docs.md`
- **Triage decision:** fix-now
- **Reasoning:** Standard Schema v1 specifies the type name as `StandardSchemaV1`. Using `StandardSchema` in documentation causes type resolution confusion.
- **Change made:**
  - Updated `StandardSchema` references to `StandardSchemaV1` across `docs/api-reference.md`, `docs/server.md`, `docs/client.md`, and `restale-kit/README.md`.
- **Tests:** `pnpm run validate` — passed cleanly.
- **Status:** done
- **Follow-ups:** None.

---

### [AUDIT2-01-003] Omission of protocol utility exports in contract spec export summary
- **Audit source:** `shard_01_spec-and-docs.md`
- **Triage decision:** fix-now
- **Reasoning:** Public protocol utility functions are exported from `restale-kit` and should be documented in the spec export summary table.
- **Change made:**
  - `spec/sse-query-invalidate-contract.md`: Added `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, `validateStandardSchema`, and `SIGNAL_TARGETS` to the root `restale-kit` export list.
- **Tests:** Manual documentation inspection — aligned with code and API reference.
- **Status:** done
- **Follow-ups:** None.

---

### [AUDIT2-01-004] `TanStackQuerySignal.exact` type discrepancy in contract spec vs implementation
- **Audit source:** `shard_01_spec-and-docs.md`
- **Triage decision:** fix-now
- **Reasoning:** Implementation uses `QueryFilters['exact']` to ensure full compatibility with TanStack Query's filter types.
- **Change made:**
  - `spec/sse-query-invalidate-contract.md`: Updated `TanStackQuerySignal.exact` type signature to `QueryFilters['exact']`.
- **Tests:** `pnpm run typecheck` — passed cleanly.
- **Status:** done
- **Follow-ups:** None.
