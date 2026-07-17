# Verification Shard 07: Package Manifest & Meta Specs

## Findings Re-Verification

### [DISC-07-01] `vitest-testing-plan.md` describes obsolete event store replay behavior superseded by Issue 4 security fix
- **Audit claim:** `vitest-testing-plan.md` stated missing/evicted event IDs return all records, while implementation returns `{ events: [], stale: true }`.
- **Re-checked evidence:**
  - `restale-kit/src/server/core/event-store.ts:L51-L55`: Code returns `stale: true` and empty events array.
  - `vitest-testing-plan.md:L114-L116`: Spec documented fallback to all records.
- **Verdict:** confirmed
- **Reasoning:** Test plan doc was outdated following security fix.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-07-02] CHANGELOG.md missing v0.2.0 entries for target-discriminated signals and scalar key matching
- **Audit claim:** `CHANGELOG.md` omitted v0.2.0 feature entries for `ReStaleSignal`, scalar key matching, and `SIGNAL_TARGETS`.
- **Re-checked evidence:**
  - `restale-kit/CHANGELOG.md:L5-L11`: Detailed breaking security changes but omitted signal expansion features.
- **Verdict:** confirmed
- **Reasoning:** Changelog was incomplete for the v0.2.0 release.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-07-03] `spec/folder-structure.md` missing `src/utils/` and `src/test-fixtures/` directories
- **Audit claim:** `spec/folder-structure.md` omitted `src/utils/` and `src/test-fixtures/`.
- **Re-checked evidence:**
  - `restale-kit/src/utils/`: Contains `constants.ts`, `id.ts`, `url.ts`.
- **Verdict:** confirmed
- **Reasoning:** Repository tree diagram omitted utility subfolders.
- **Correction (if any):** None.
- **Confidence:** high
