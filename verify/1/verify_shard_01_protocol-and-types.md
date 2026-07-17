# Verification Shard 01: Protocol Specification & Types

## Findings Re-Verification

### [DISC-01-01] Wire signal type expansion (discriminated union) not documented in Spec or API Reference
- **Audit claim:** Spec and API reference documented `InvalidateSignal` as a single generic structure with `key: JSONValue[]`, whereas implementation used `ReStaleSignal` discriminated union (`TanStackQuerySignal`, `SWRSignal`, `RTKQuerySignal`, `GenericInvalidateSignal`).
- **Re-checked evidence:**
  - `restale-kit/src/types/protocol.ts:L61-L68`: Implementation defines `export type InvalidateSignal = ReStaleSignal`.
  - `spec/sse-query-invalidate-contract.md:L107-L140`: Spec previously only listed generic `key` and `action` interface.
  - `docs/api-reference.md:L22-L26`: API reference omitted framework target discriminator union.
- **Verdict:** confirmed
- **Reasoning:** Implementation is the source of truth; spec and docs had drifted behind the code's native framework signal support.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-01-02] Omission of exported protocol/schema utility functions in API Reference and Spec
- **Audit claim:** `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, `SIGNAL_TARGETS`, and `validateStandardSchema` are exported from root `restale-kit` but omitted from `docs/api-reference.md` and `spec/sse-query-invalidate-contract.md`.
- **Re-checked evidence:**
  - `restale-kit/src/types/index.ts:L17`: `export { isJSONValue, isJSONValueArray, matchesInvalidateSignalKey, SIGNAL_TARGETS } from './protocol.js'` and `export { validateStandardSchema } from './standard-schema.js'`.
  - `restale-kit/src/index-exports.test.ts:L22-L35`: Unit tests verify root exports.
- **Verdict:** confirmed
- **Reasoning:** Primary exports in `index.ts` must be mirrored in official API documentation.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-01-03] Undocumented asymmetry in `matchesInvalidateSignalKey` for scalar string cache keys
- **Audit claim:** When `cacheKey` is a scalar string, `matchesInvalidateSignalKey` returns `true` for TanStack/SWR signals but `false` for `GenericInvalidateSignal`.
- **Re-checked evidence:**
  - `restale-kit/src/types/protocol.ts:L95-L105`: Code explicitly returns `false` for scalar keys when matching generic signals.
  - `restale-kit/src/types/protocol.test.ts:L117-L123`: Test confirms scalar key returns `false` for generic signals.
- **Verdict:** confirmed
- **Reasoning:** The behavior is intentional in code and tested, but was completely undocumented.
- **Correction (if any):** None.
- **Confidence:** high
