# Batch: Meta / Internal Docs (FINDING-013, FINDING-010, FINDING-011, FINDING-016)

**Audit shard:** `shard_general-and-meta.md`

---

### [FINDING-013] `test:package` and CI use different test commands

- **Audit source:** `shard_general-and-meta.md`
- **Triage decision:** fix-now
- **Reasoning:** CI runs `test:coverage`; local `test:package` runs plain `test` (no coverage). A developer replicating CI locally would run different commands and not collect coverage. Added `test:ci` (mirrors CI: `test:coverage` + `verify-package.mjs`) rather than mutating `test:package` to preserve the no-overhead convenience variant.
- **Change made:**
  1. `package.json` — added `"test:ci": "pnpm --filter restale-kit run test:coverage && node scripts/verify-package.mjs"`
  2. `README.md` — added "To replicate the exact CI test run" section pointing to `pnpm run test:ci`
- **Tests:** n/a (script addition)
- **Status:** done
- **Follow-ups:** None.

---

### [FINDING-010] Vitest testing plan documents fixture path `test/fixtures/` that doesn't exist

- **Audit source:** `shard_general-and-meta.md`
- **Triage decision:** fix-now
- **Reasoning:** The plan's `test/fixtures/` path was never adopted; fixtures live at `src/test-fixtures/`. While internal/historical, the stale path could mislead a future contributor adding fixtures.
- **Change made:** `vitest-testing-plan.md` — updated the test layout codeblock to show `test-fixtures/` inside `src/` with a note `← actual location (was test/fixtures/ in early draft)`.
- **Tests:** None needed.
- **Status:** done
- **Follow-ups:** None.

---

### [FINDING-011] Vitest testing plan describes a `tsconfig.build.json` fix already applied

- **Audit source:** `shard_general-and-meta.md`
- **Triage decision:** fix-now
- **Reasoning:** The plan showed an incomplete exclusion pattern and described it as needing to be updated — but the fix had already been applied. The plan read as pending work that was actually done.
- **Change made:** `vitest-testing-plan.md` — added a `> ✅ Done` blockquote after the original snippet showing the actual (current) `tsconfig.build.json` exclusion list including `src/test-fixtures/**`.
- **Tests:** None needed.
- **Status:** done
- **Follow-ups:** None.

---

### [FINDING-016] Issue 7 (multi-line JSON) security regression test is indirect

- **Audit source:** `shard_general-and-meta.md`
- **Triage decision:** fix-now
- **Reasoning:** The data-split portion of the Issue 7 test hand-rolls the split algorithm rather than calling `formatInvalidateFrame` with a real multi-line input. The ID sanitisation test in the same describe block is the meaningful regression guard. Without a comment, a future reader might not understand why the test is structured this way (or try to "fix" it by calling the public function with a forced newline).
- **Change made:** `restale-kit/src/security-regression.test.ts` — added a prominent comment at the top of the `multi-line JSON payload` test case explaining that this code path is unreachable from the public API via normal signals, and that the meaningful regression is the ID sanitisation test.
- **Tests:** Tests still pass (319/319).
- **Status:** done
- **Follow-ups:** None.
