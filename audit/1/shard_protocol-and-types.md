# Audit Ledger Shard: Protocol and Types

## Inventory Covered
- `spec/sse-query-invalidate-contract.md` (Wire Protocol & Types sections)
- `docs/validation.md`
- `docs/api-reference.md`
- `restale-kit/src/types/protocol.ts`
- `restale-kit/src/types/errors.ts`
- `restale-kit/src/types/standard-schema.ts`
- `restale-kit/src/types/index.ts`
- `restale-kit/src/utils/constants.ts`
- `restale-kit/src/utils/id.ts`
- `restale-kit/src/utils/url.ts`
- `restale-kit/src/types/protocol.test.ts`
- `restale-kit/src/types/standard-schema.test.ts`
- `restale-kit/src/utils/id.test.ts`
- `restale-kit/src/utils/url.test.ts`

---

### [FINDING-001] Outdated structural validation rules in documentation
- **Area:** `docs/validation.md:15-17` vs `restale-kit/src/client/core/validation.ts:90-190`
- **Type:** outdated-doc
- **Evidence:**
  - `docs/validation.md:15-17`:
    ```markdown
    3. Each object must have a `key` property that is an `Array`.
    4. `exact` (if present) must be `boolean`.
    5. `action` (if present) must be `'invalidate' | 'refetch' | 'remove'`.
    ```
  - `restale-kit/src/client/core/validation.ts:97-162`:
    ```ts
    if (target === SIGNAL_TARGETS.TANSTACK) { ... requires queryKey ... }
    if (target === SIGNAL_TARGETS.SWR) { ... key can be string or Array ... }
    if (target === SIGNAL_TARGETS.RTK) { ... requires tags array ... }
    ```
- **Discrepancy:** `docs/validation.md` states that every signal object must have a `key` property that is an `Array` and actions restricted to `'invalidate' | 'refetch' | 'remove'`. This ignores target-discriminated signals (`tanstack-query` which uses `queryKey`, `swr` which accepts string `key` or array `key`, and `rtk-query` which uses `tags`).
- **Which source is correct / should be trusted:** Implementation (`validation.ts`) and spec (`sse-query-invalidate-contract.md`) are correct. The documentation was not updated when target-discriminated signals were added.
- **Recommended fix:** Update `docs/validation.md` to list structural validation rules per signal target (`tanstack-query`, `swr`, `rtk-query`, `generic`).
- **Severity:** medium
- **Confidence:** high

### [FINDING-002] Agreement verification: Protocol types, standard schema validation, and key matching
- **Area:** `spec/sse-query-invalidate-contract.md`, `restale-kit/src/types/protocol.ts`, `restale-kit/src/types/standard-schema.ts`, `restale-kit/src/utils/*`
- **Status:** PASS / Agreed
- **Notes:** Protocol types (`JSONValue`, `TanStackQuerySignal`, `SWRSignal`, `RTKQuerySignal`, `GenericInvalidateSignal`), error classes (`ChannelClosedError`, `SchemaValidationError`), key matching logic (`matchesInvalidateSignalKey`), standard schema validation (`validateStandardSchema`), and utility functions (`generateUUID`, `appendQueryParam`) fully align across spec, implementation, and unit tests.
