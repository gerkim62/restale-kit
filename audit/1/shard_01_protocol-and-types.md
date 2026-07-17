# Audit Shard 01: Protocol Specification & Types

## Scope
- Spec: `spec/sse-query-invalidate-contract.md` (Sections: Purpose, Wire protocol, Exported type surface, Standard Schema)
- Docs: `README.md`, `restale-kit/README.md`, `docs/api-reference.md`, `docs/validation.md`
- Code: `restale-kit/src/types/protocol.ts`, `restale-kit/src/types/errors.ts`, `restale-kit/src/types/index.ts`, `restale-kit/src/types/standard-schema.ts`, `restale-kit/src/utils/constants.ts`, `restale-kit/src/utils/id.ts`, `restale-kit/src/utils/url.ts`
- Tests: `restale-kit/src/types/protocol.test.ts`, `restale-kit/src/types/standard-schema.test.ts`, `restale-kit/src/utils/id.test.ts`, `restale-kit/src/utils/url.test.ts`, `restale-kit/src/index-exports.test.ts`

---

## Discrepancies

### [DISC-01-01] Wire signal type expansion (discriminated union) not documented in Spec or API Reference
- **Area:** `spec/sse-query-invalidate-contract.md:L107-L114`, `docs/api-reference.md:L22-L26`, `restale-kit/src/types/protocol.ts:L22-L68`
- **Type:** outdated-doc
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md:L107-L111`:
    ```ts
    interface InvalidateSignal {
      key: JSONValue[]          // hierarchical key — e.g. ["todos", { userId: 4 }]
      exact?: boolean           // default false: prefix match
      action?: 'invalidate' | 'refetch' | 'remove'   // default 'invalidate'
    }
    ```
  - `docs/api-reference.md:L22-L26`:
    ```ts
    interface InvalidateSignal {
      key: JSONValue[]
      exact?: boolean                                     // default false
      action?: 'invalidate' | 'refetch' | 'remove'       // default 'invalidate'
    }
    ```
  - `restale-kit/src/types/protocol.ts:L61-L68`:
    ```ts
    export type ReStaleSignal =
      | TanStackQuerySignal
      | SWRSignal
      | RTKQuerySignal
      | GenericInvalidateSignal

    export type InvalidateSignal = ReStaleSignal
    ```
- **Discrepancy:** The specification and API reference document `InvalidateSignal` as a single generic structure with `key: JSONValue[]`. The codebase expanded `InvalidateSignal` to a discriminated union (`ReStaleSignal`) supporting framework-specific signals (`tanstack-query`, `swr`, `rtk-query`) and generic signals.
- **Which source is correct / should be trusted:** Implementation (`protocol.ts`). The framework-specific target signals were deliberately added to support TanStack Query, SWR, and RTK Query natively over SSE.
- **Recommended fix:** Update `spec/sse-query-invalidate-contract.md` and `docs/api-reference.md` to document `ReStaleSignal` discriminated union, `SIGNAL_TARGETS`, and the target-specific payload shapes.
- **Severity:** high
- **Confidence:** high

### [DISC-01-02] Omission of exported protocol/schema utility functions in API Reference and Spec
- **Area:** `spec/sse-query-invalidate-contract.md:L729`, `docs/api-reference.md:L9-L13`, `restale-kit/src/types/index.ts:L17`
- **Type:** outdated-doc
- **Evidence:**
  - `restale-kit/src/types/index.ts:L17`:
    ```ts
    export { isJSONValue, isJSONValueArray, matchesInvalidateSignalKey, SIGNAL_TARGETS } from './protocol.js'
    export { validateStandardSchema } from './standard-schema.js'
    ```
  - `docs/api-reference.md:L9-L13`:
    ```ts
    import type { JSONValue, InvalidateSignal, SSEInvalidateEvent, ChannelState } from 'restale-kit'
    import { ChannelClosedError, SchemaValidationError } from 'restale-kit'
    ```
- **Discrepancy:** `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, `SIGNAL_TARGETS`, and `validateStandardSchema` are exported from the root `restale-kit` package and verified in `index-exports.test.ts`, but are absent from `docs/api-reference.md` and `spec/sse-query-invalidate-contract.md`.
- **Which source is correct / should be trusted:** Implementation (`src/types/index.ts`). These utility functions are essential public helpers for validating signals and checking key matching.
- **Recommended fix:** Add `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, `SIGNAL_TARGETS`, and `validateStandardSchema` to `docs/api-reference.md` under the root `restale-kit` subpath export section, and update the table in `spec/sse-query-invalidate-contract.md`.
- **Severity:** medium
- **Confidence:** high

### [DISC-01-03] Undocumented asymmetry in `matchesInvalidateSignalKey` for scalar string cache keys
- **Area:** `restale-kit/src/types/protocol.ts:L95-L105`, `restale-kit/src/types/protocol.test.ts:L117-L123`
- **Type:** undocumented-behavior
- **Evidence:**
  - `restale-kit/src/types/protocol.ts:L95-L105`:
    ```ts
    if (typeof cacheKey === 'string') {
      if ('target' in signal && signal.target === SIGNAL_TARGETS.SWR) { ... }
      if ('target' in signal && signal.target === SIGNAL_TARGETS.TANSTACK) { ... }
      return false
    }
    ```
  - `restale-kit/src/types/protocol.test.ts:L117-L123`:
    ```ts
    const tanstackSignal = { target: 'tanstack-query' as const, queryKey: ['/api/user'] }
    expect(matchesInvalidateSignalKey('/api/user', tanstackSignal)).toBe(true)

    const genericSignal = { key: ['/api/user'] }
    expect(matchesInvalidateSignalKey('/api/user', genericSignal)).toBe(false)
    ```
- **Discrepancy:** When `cacheKey` is a scalar string (e.g. `'/api/user'`), `matchesInvalidateSignalKey` returns `true` if `signal` is a TanStack or SWR signal with matching `queryKey`/`key`, but returns `false` if `signal` is a `GenericInvalidateSignal` with `key: ['/api/user']`. This asymmetry is tested but never explained in specifications or documentation.
- **Which source is correct / should be trusted:** Implementation. However, the rule should be documented in `docs/validation.md` or `docs/api-reference.md` so users understand why generic signals require array cache keys.
- **Recommended fix:** Document the key matching rules for scalar vs array cache keys across signal target types in `docs/validation.md`.
- **Severity:** low
- **Confidence:** high

---

## Verified Correct Behavior (Agreements)
- `ChannelClosedError` and `SchemaValidationError` behavior, properties (`issues`), and error formatting match across spec, docs, and implementation.
- `StandardSchemaV1` interface inlining and synchronous validation behavior (`validateStandardSchema` throwing when receiving a `Promise`) match spec and implementation.
- `JSONValue` type definition is strictly lossless for JSON serialization across spec, docs, and code.
- `generateUUID` in `src/utils/id.ts` and `appendQueryParam` in `src/utils/url.ts` have comprehensive unit tests in `id.test.ts` and `url.test.ts`.
