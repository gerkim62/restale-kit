# Fixes 3 Batch 02: Types, Protocol Schemas, and Test Coverage

## Summary
Addresses findings from `shard_02_types-protocol-utils.md`.

---

### [AUDIT3-02-01] `matchesInvalidateSignalKey` always returns `false` for `RTKQuerySignal`
- **Audit source:** `shard_02_types-protocol-utils.md`
- **Triage decision:** fix-now
- **Reasoning:** Add explicit test asserting `matchesInvalidateSignalKey` returns `false` when passed an `RTKQuerySignal`, confirming tag-based signals are skipped by key matching.
- **Change made:** Added unit test in `restale-kit/src/types/protocol.test.ts`.
- **Tests:** `pnpm run test` (passed).
- **Status:** done
- **Follow-ups:** None.

---

### [AUDIT3-02-02] Incomplete coverage in `index-exports.test.ts` for all entrypoints
- **Audit source:** `shard_02_types-protocol-utils.md`
- **Triage decision:** fix-now
- **Reasoning:** Ensure all subpath exports defined in `package.json` are verified in `index-exports.test.ts`.
- **Change made:** Added imports and assertions for `redisPubSubAdapter`, `ablyPubSubAdapter`, `pusherPubSubAdapter`, and `PubSubDecryptionError` in `restale-kit/src/index-exports.test.ts`.
- **Tests:** `pnpm run test` (passed).
- **Status:** done
- **Follow-ups:** None.
