# Audit Shard 01: Core Spec and Documentation Consistency

### [AUDIT2-01-001] Contradiction on StandardSchemaV1 export claim in spec vs index exports
- **Area:** `spec/sse-query-invalidate-contract.md`, `restale-kit/src/types/index.ts`, `docs/api-reference.md`
- **Type:** contradiction
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md:808-810`:
    ```markdown
    `StandardSchemaV1` is **not** re-exported — the type interface is inlined in the library's source
    (per the [Standard Schema spec's recommendation](https://github.com/standard-schema/standard-schema)).
    ```
  - `restale-kit/src/types/index.ts:3`:
    ```ts
    export type { StandardSchemaV1 } from './standard-schema.js'
    ```
  - `docs/api-reference.md:10-20`: Does not list `StandardSchemaV1` in the exported types list for `restale-kit`.
- **Discrepancy:** The contract spec claims `StandardSchemaV1` is intentionally NOT re-exported from the package root, but `restale-kit/src/types/index.ts` explicitly re-exports `StandardSchemaV1`.
- **Which source is correct / should be trusted:** `restale-kit/src/types/index.ts` (Implementation). Re-exporting `StandardSchemaV1` as a type-only export is helpful for TypeScript consumers who need to type schema parameters without adding `@standard-schema/spec` as a direct dependency.
- **Recommended fix:** Update `spec/sse-query-invalidate-contract.md` to document that `StandardSchemaV1` is re-exported as a type-only export from `restale-kit`, and add `StandardSchemaV1` to the export list in `docs/api-reference.md`.
- **Severity:** medium
- **Confidence:** high

---

### [AUDIT2-01-002] Documentation uses `StandardSchema` instead of `StandardSchemaV1`
- **Area:** `docs/api-reference.md`, `docs/server.md`, `docs/client.md`, `restale-kit/README.md`, `restale-kit/src/types/standard-schema.ts`
- **Type:** outdated-doc
- **Evidence:**
  - `docs/api-reference.md:128`: `signalSchema?: StandardSchema<unknown, TSignal>`
  - `docs/api-reference.md:176`: `metaSchema?: StandardSchema<unknown, TMeta>`
  - `docs/api-reference.md:342`: `signalSchema?: StandardSchema<unknown, TSignal>`
  - `docs/server.md:134`: `metaSchema` | `StandardSchema`
  - `docs/client.md:62`: `signalSchema?: StandardSchema`
  - `restale-kit/README.md:367`: `signalSchema` | `StandardSchema`
  - `restale-kit/src/types/standard-schema.ts:10`: `export interface StandardSchemaV1<Input = unknown, Output = Input>`
- **Discrepancy:** The documentation files refer to the schema interface type as `StandardSchema` or `StandardSchema<unknown, T>`, whereas the actual type name defined and exported by `restale-kit` is `StandardSchemaV1` (following the official v1 spec naming).
- **Which source is correct / should be trusted:** Implementation (`StandardSchemaV1`). Standard Schema v1 explicitly names its interface `StandardSchemaV1`.
- **Recommended fix:** Update references in `docs/api-reference.md`, `docs/server.md`, `docs/client.md`, and `restale-kit/README.md` from `StandardSchema` to `StandardSchemaV1`.
- **Severity:** low
- **Confidence:** high

---

### [AUDIT2-01-003] Omission of protocol utility exports in contract spec export summary
- **Area:** `spec/sse-query-invalidate-contract.md`, `docs/api-reference.md`, `restale-kit/src/types/index.ts`
- **Type:** outdated-doc
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md:789-800`:
    ```markdown
    | Subpath | Exported symbols |
    |---|---|
    | `restale-kit` | `JSONValue`, `InvalidateSignal`, `SSEInvalidateEvent`, `ChannelState`, shared errors and schema helpers |
    ```
  - `restale-kit/src/types/index.ts:17`:
    ```ts
    export { isJSONValue, isJSONValueArray, matchesInvalidateSignalKey, SIGNAL_TARGETS } from './protocol.js'
    ```
  - `docs/api-reference.md:21-29`:
    ```ts
    export {
      ChannelClosedError,
      SchemaValidationError,
      SIGNAL_TARGETS,
      isJSONValue,
      isJSONValueArray,
      matchesInvalidateSignalKey,
      validateStandardSchema,
    } from 'restale-kit'
    ```
- **Discrepancy:** The contract spec table omits `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, and `SIGNAL_TARGETS` from the explicit list of exported symbols for `restale-kit`.
- **Which source is correct / should be trusted:** Implementation and `docs/api-reference.md`. These functions and constants are part of the public API surface.
- **Recommended fix:** Update `spec/sse-query-invalidate-contract.md` export summary table to explicitly include `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, and `SIGNAL_TARGETS`.
- **Severity:** low
- **Confidence:** high

---

### [AUDIT2-01-004] `TanStackQuerySignal.exact` type discrepancy in contract spec vs implementation
- **Area:** `spec/sse-query-invalidate-contract.md`, `restale-kit/src/types/protocol.ts`
- **Type:** implementation-drift
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md:117`:
    ```ts
    interface TanStackQuerySignal {
      target: 'tanstack-query'
      queryKey: JSONValue[]
      exact?: boolean
      type?: 'active' | 'inactive' | 'all'
      action?: 'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel'
      stale?: boolean
    }
    ```
  - `restale-kit/src/types/protocol.ts:25`:
    ```ts
    export interface TanStackQuerySignal {
      target: typeof SIGNAL_TARGETS.TANSTACK
      queryKey: JSONValue[]
      exact?: QueryFilters['exact']
      type?: QueryFilters['type']
      action?: TanStackQueryAction
      stale?: boolean
    }
    ```
- **Discrepancy:** Spec defines `exact?: boolean`, whereas the implementation types `exact` using `QueryFilters['exact']` from `@tanstack/react-query`.
- **Which source is correct / should be trusted:** Implementation (`QueryFilters['exact']`), which preserves exact compatibility with TanStack Query's filter options.
- **Recommended fix:** Note in `spec/sse-query-invalidate-contract.md` that `exact` is typed against `QueryFilters['exact']`.
- **Severity:** low
- **Confidence:** high
