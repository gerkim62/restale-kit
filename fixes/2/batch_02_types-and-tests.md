# Fix Batch 02: Protocol Types, Utils, and Test Assertions

### [AUDIT2-02-001] Missing test assertion for `SIGNAL_TARGETS` in `index-exports.test.ts`
- **Audit source:** `shard_02_types-protocol-utils.md`
- **Triage decision:** fix-now
- **Reasoning:** `SIGNAL_TARGETS` is a public exported constant. The index export test should explicitly verify it.
- **Change made:**
  - `restale-kit/src/index-exports.test.ts`: Added `SIGNAL_TARGETS` import and `expect(SIGNAL_TARGETS).toBeDefined()` assertion.
- **Tests:** `pnpm --filter restale-kit run test` — passed.
- **Status:** done
- **Follow-ups:** None.

---

### [AUDIT2-02-002] Generic signals reject scalar string cache keys in `matchesInvalidateSignalKey`
- **Audit source:** `shard_02_types-protocol-utils.md`
- **Triage decision:** fix-now
- **Reasoning:** This is intentional behavior (generic hierarchical key matching requires array-form keys), but was not documented in the wire protocol specification.
- **Change made:**
  - `spec/sse-query-invalidate-contract.md`: Documented that scalar string cache keys return `false` when evaluated against `GenericInvalidateSignal`.
- **Tests:** `restale-kit/src/types/protocol.test.ts` — passed existing tests verifying string cache key matching behavior for framework signals vs generic signals.
- **Status:** done
- **Follow-ups:** None.
