# Audit 3 Shard 01: Core Specifications vs Documentation Consistency

## Reviewed Sources
- `spec/README.md`
- `spec/folder-structure.md`
- `spec/sse-query-invalidate-contract.md`
- `spec/pubsub-adapter-contract.md`
- `spec/restale-kit-connection-revocation-spec.md`
- `README.md`
- `docs/README.md`
- `docs/getting-started.md`
- `docs/api-reference.md`
- `docs/client.md`
- `docs/server.md`
- `docs/pubsub.md`
- `docs/validation.md`
- `restale-kit/README.md`
- `restale-kit/CHANGELOG.md`

---

### [AUDIT3-01-01] `PubSubEncryptionOptions` type signature omitted `encryptionKey?: never` in spec
- **Area:** `spec/pubsub-adapter-contract.md` vs `docs/api-reference.md` & `restale-kit/src/pubsub/core/index.ts`
- **Type:** outdated-doc / spec-drift
- **Evidence:**
  - `spec/pubsub-adapter-contract.md:79-82`:
    ```ts
    export type PubSubEncryptionOptions =
      | { encrypt: false }
      | { encryptionKey: string; encrypt?: true }
    ```
  - `docs/api-reference.md:482-484` & `restale-kit/src/pubsub/core/index.ts:3-5`:
    ```ts
    export type PubSubEncryptionOptions =
      | { encrypt: false; encryptionKey?: never }
      | { encrypt?: true; encryptionKey: string }
    ```
- **Discrepancy:** The spec document is missing `encryptionKey?: never` on the unencrypted branch of the discriminated union, which is present in both code and API documentation to prevent invalid configurations like `{ encrypt: false, encryptionKey: '...' }` from compiling.
- **Which source is correct / should be trusted:** Implementation and API docs are correct.
- **Recommended fix:** Update `spec/pubsub-adapter-contract.md` to include `encryptionKey?: never`.
- **Severity:** low
- **Confidence:** high

---

### [AUDIT3-01-02] Incomplete exported type surface table in contract spec
- **Area:** `spec/sse-query-invalidate-contract.md` vs `docs/api-reference.md` & `restale-kit/src/types/index.ts`
- **Type:** outdated-doc
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md:793`:
    Lists symbols for `restale-kit`: `JSONValue`, `ReStaleSignal`, `InvalidateSignal`, `SSEInvalidateEvent`, `ChannelState`, `SIGNAL_TARGETS`, `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, `validateStandardSchema`, `StandardSchemaV1`, `ChannelClosedError`, `SchemaValidationError`.
  - `restale-kit/src/types/index.ts:7-13`:
    Also exports `TanStackQuerySignal`, `TanStackQueryAction`, `SWRSignal`, `SWRAction`, `RTKQuerySignal`, `GenericInvalidateSignal`.
  - `spec/sse-query-invalidate-contract.md:802`:
    Lists `restale-kit/pubsub` exports as `PubSubAdapter`, missing `PubSubEncryptionOptions` and `PubSubDecryptionError`.
- **Discrepancy:** The exported type surface table in the contract spec omits several exported signals, actions, and pub/sub error/options types.
- **Which source is correct / should be trusted:** Implementation and `docs/api-reference.md` are correct.
- **Recommended fix:** Update table in `spec/sse-query-invalidate-contract.md` to reflect all exported types.
- **Severity:** low
- **Confidence:** high

---

### [AUDIT3-01-03] RTK Query Signal specified in protocol contract but no RTK Query adapter package exists
- **Area:** `spec/sse-query-invalidate-contract.md` vs `restale-kit/` client adapters
- **Type:** spec-not-implemented
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md:131-134`:
    Defines `RTKQuerySignal` with `target: 'rtk-query'`.
  - `restale-kit/src/types/protocol.ts:44-47`:
    Contains `RTKQuerySignal` definition.
  - `restale-kit/package.json`: No `./rtk-query` export or adapter exists.
- **Discrepancy:** `RTKQuerySignal` is defined in wire protocol types and spec, but no `restale-kit/rtk-query` adapter implementation or package export exists in `restale-kit`.
- **Which source is correct / should be trusted:** Code design is intentionally supporting generic wire targets for future adapters or userland handlers, but the lack of native RTK Query adapter should be documented clearly as a non-goal for v0.2.
- **Recommended fix:** Note in `spec/sse-query-invalidate-contract.md` that `RTKQuerySignal` is a wire protocol seam reserved for future/userland integrations.
- **Severity:** low
- **Confidence:** high
