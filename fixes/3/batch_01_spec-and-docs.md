# Fixes 3 Batch 01: Core Specifications vs Documentation

## Summary
Addresses findings from `shard_01_spec-and-docs.md`.

---

### [AUDIT3-01-01] `PubSubEncryptionOptions` type signature omitted `encryptionKey?: never` in spec
- **Audit source:** `shard_01_spec-and-docs.md`
- **Triage decision:** fix-now
- **Reasoning:** Specification doc should accurately state the discriminated union shape implemented in code and API reference.
- **Change made:** Updated `spec/pubsub-adapter-contract.md` to include `encryptionKey?: never` on the unencrypted branch.
- **Tests:** None needed (documentation change).
- **Status:** done
- **Follow-ups:** None.

---

### [AUDIT3-01-02] Incomplete exported type surface table in contract spec
- **Audit source:** `shard_01_spec-and-docs.md`
- **Triage decision:** fix-now
- **Reasoning:** Specification doc table should list all exported signal, action, and pub/sub error/option types.
- **Change made:** Updated exported type surface table in `spec/sse-query-invalidate-contract.md` to include `TanStackQuerySignal`, `TanStackQueryAction`, `SWRSignal`, `SWRAction`, `RTKQuerySignal`, `GenericInvalidateSignal`, `PubSubEncryptionOptions`, `PubSubDecryptionError`.
- **Tests:** None needed (documentation change).
- **Status:** done
- **Follow-ups:** None.

---

### [AUDIT3-01-03] RTK Query Signal specified in protocol contract but no RTK Query adapter package exists
- **Audit source:** `shard_01_spec-and-docs.md`
- **Triage decision:** fix-now
- **Reasoning:** Clarify in spec that `RTKQuerySignal` is an intentional wire protocol extensibility seam reserved for tag-based query invalidation.
- **Change made:** Added clarification note in `spec/sse-query-invalidate-contract.md` following `RTKQuerySignal` definition.
- **Tests:** None needed (documentation change).
- **Status:** done
- **Follow-ups:** None.
