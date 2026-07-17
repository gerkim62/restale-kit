# Audit Shard 07: Package Manifest & Meta Specs

## Scope
- `restale-kit/package.json` vs `package.json`
- `restale-kit/CHANGELOG.md`
- `vitest-testing-plan.md`
- `spec/folder-structure.md`
- `spec/README.md`

---

## Discrepancies

### [DISC-07-01] `vitest-testing-plan.md` describes obsolete event store replay behavior superseded by Issue 4 security fix
- **Area:** `vitest-testing-plan.md:L114-L116`, `restale-kit/src/server/core/event-store.ts:L51-L55`, `restale-kit/src/security-regression.test.ts:L209-L272`
- **Type:** outdated-doc
- **Evidence:**
  - `vitest-testing-plan.md:L114-L116`:
    `event-store.ts: generated/custom IDs, overflow, clear, and getEventsAfter. A missing or evicted ID deliberately returns all current records... Since EventStore.getEventsAfter falls back to all records...`
  - `restale-kit/src/server/core/event-store.ts:L51-L55`:
    `getEventsAfter` returns `{ events: [], stale: true }` when `lastEventId` is not found, prompting the channel to emit a full-invalidation frame `{ key: [] }`.
  - `restale-kit/src/security-regression.test.ts:L209-L272`:
    Verifies that missing or evicted IDs return `stale: true` and empty `events: []`.
- **Discrepancy:** `vitest-testing-plan.md` states that `getEventsAfter` returns all current records for missing/evicted IDs. The implementation was changed to return `stale: true` and empty events to prevent silently missed events or unintended replay scans (Issue 4 security fix).
- **Which source is correct / should be trusted:** Implementation (`event-store.ts`) and `security-regression.test.ts`.
- **Recommended fix:** Update `vitest-testing-plan.md` to reflect the `{ events: [], stale: true }` return value and full-invalidation frame response.
- **Severity:** medium
- **Confidence:** high

### [DISC-07-02] CHANGELOG.md missing v0.2.0 entries for target-discriminated signals and scalar key matching
- **Area:** `restale-kit/CHANGELOG.md:L5-L11`, `restale-kit/src/types/protocol.ts:L61-L68`
- **Type:** outdated-doc
- **Evidence:**
  - `restale-kit/CHANGELOG.md:L5-L11`:
    Lists breaking changes for encryption options on PubSub adapters, AAD binding, and throttled warning logs for decryption errors.
  - Git history & `restale-kit/src/types/protocol.ts`:
    Commit `b5b127e` and `3347afd` added `ReStaleSignal` discriminated union (`TanStackQuerySignal`, `SWRSignal`, `RTKQuerySignal`, `GenericInvalidateSignal`), scalar cache key matching, and `SIGNAL_TARGETS` export.
- **Discrepancy:** `CHANGELOG.md` for release `v0.2.0` does not mention the addition of framework target signals (`tanstack-query`, `swr`, `rtk-query`), scalar key matching in `matchesInvalidateSignalKey`, or `SIGNAL_TARGETS` export.
- **Which source is correct / should be trusted:** Implementation.
- **Recommended fix:** Add entries for `ReStaleSignal`, scalar key matching, and `SIGNAL_TARGETS` to `restale-kit/CHANGELOG.md` under `[0.2.0]`.
- **Severity:** low
- **Confidence:** high

### [DISC-07-03] `spec/folder-structure.md` missing `src/utils/` and `src/test-fixtures/` directories
- **Area:** `spec/folder-structure.md:L1-L24`, `restale-kit/src/utils/`
- **Type:** outdated-doc
- **Evidence:**
  - `spec/folder-structure.md:L1-L24`:
    Lists `src/types/`, `src/server/`, `src/client/`, `src/pubsub/`.
  - Directory structure:
    `restale-kit/src/utils/` contains `constants.ts`, `id.ts`, `url.ts`, and `restale-kit/src/test-fixtures/` contains test doubles.
- **Discrepancy:** `spec/folder-structure.md` omits `src/utils/` and `src/test-fixtures/` from the repository layout tree.
- **Which source is correct / should be trusted:** Implementation filesystem structure.
- **Recommended fix:** Update `spec/folder-structure.md` tree diagram to include `src/utils/` and `src/test-fixtures/`.
- **Severity:** low
- **Confidence:** high

---

## Verified Correct Behavior (Agreements)
- All 15 subpath exports in `restale-kit/package.json` (`.`, `./server`, `./node`, `./fetch`, `./client`, `./react`, `./swr`, `./tanstack-query`, `./pubsub`, `./redis`, `./ably`, `./pusher`, `./express`, `./fastify`, `./hono`) point to existing `.d.ts` and `.js` entrypoints in `./dist/`.
- `peerDependenciesMeta` correctly flags framework and pub/sub dependencies (`react`, `@tanstack/react-query`, `swr`, `ioredis`, `ably`, `pusher`) as optional.
