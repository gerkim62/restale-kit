# Audit Shard 02: Types, Protocol, Standard Schema, and Utilities

### [AUDIT2-02-001] Missing test assertion for `SIGNAL_TARGETS` in `index-exports.test.ts`
- **Area:** `restale-kit/src/types/index.ts`, `restale-kit/src/index-exports.test.ts`
- **Type:** missing-test
- **Evidence:**
  - `restale-kit/src/types/index.ts:17`:
    ```ts
    export { isJSONValue, isJSONValueArray, matchesInvalidateSignalKey, SIGNAL_TARGETS } from './protocol.js'
    ```
  - `restale-kit/src/index-exports.test.ts:40-47`:
    ```ts
    it('correctly exports types and protocol helpers', () => {
      expect(ChannelClosedError).toBeDefined()
      expect(SchemaValidationError).toBeDefined()
      expect(validateStandardSchema).toBeDefined()
      expect(isJSONValue).toBeDefined()
      expect(isJSONValueArray).toBeDefined()
      expect(matchesInvalidateSignalKey).toBeDefined()
    })
    ```
- **Discrepancy:** `SIGNAL_TARGETS` is exported from `restale-kit` (root index), but `index-exports.test.ts` does not assert that `SIGNAL_TARGETS` is defined on the root entrypoint export.
- **Which source is correct / should be trusted:** `restale-kit/src/types/index.ts` (Implementation). `SIGNAL_TARGETS` is a public exported constant.
- **Recommended fix:** Add `expect(SIGNAL_TARGETS).toBeDefined()` to `restale-kit/src/index-exports.test.ts`.
- **Severity:** low
- **Confidence:** high

---

### [AUDIT2-02-002] Generic signals reject scalar string cache keys in `matchesInvalidateSignalKey`
- **Area:** `restale-kit/src/types/protocol.ts:94-131`, `spec/sse-query-invalidate-contract.md:137-142`, `docs/validation.md:26`
- **Type:** undocumented-behavior
- **Evidence:**
  - `restale-kit/src/types/protocol.ts:95-106`:
    ```ts
    if (typeof cacheKey === 'string') {
      if ('target' in signal && signal.target === SIGNAL_TARGETS.SWR) { ... }
      if ('target' in signal && signal.target === SIGNAL_TARGETS.TANSTACK) { ... }
      return false
    }
    ```
  - `docs/validation.md:26`: "For `GenericInvalidateSignal`, scalar cache keys return `false` because generic signals require array cache keys for hierarchical prefix evaluation."
  - `spec/sse-query-invalidate-contract.md:137-142`: Does not mention that scalar string cache keys return `false` when evaluated against `GenericInvalidateSignal`.
- **Discrepancy:** While `docs/validation.md` documents this behavior, `spec/sse-query-invalidate-contract.md` does not explain why generic invalidation signals require array-form cache keys and reject scalar string cache keys.
- **Which source is correct / should be trusted:** Implementation & `docs/validation.md`. Hierarchical prefix evaluation relies on array structures.
- **Recommended fix:** Document scalar string cache key rejection for `GenericInvalidateSignal` in `spec/sse-query-invalidate-contract.md`.
- **Severity:** low
- **Confidence:** high
