# Fixes 1 — Progress Tracker

One line per status change. Format: `[FINDING-ID] status — note`

---

- [START] Triage pass complete — all 10 actionable findings: fix-now; FINDING-023 is a pattern-note, no separate fix needed
- [FINDING-021] triaged: fix-now — export PubSubMessage from types/index.ts
- [FINDING-008] triaged: fix-now — export EventStore from server/core/index.ts + add to api-reference.md
- [FINDING-020] triaged: fix-now — replace v0.1 interface with discriminated union in README
- [FINDING-022] triaged: fix-now — README SWR actions table needs GenericInvalidateSignal note + SWRSignal actions
- [FINDING-007] triaged: fix-now — add onRevoke row to README useReStale table
- [FINDING-024] triaged: fix-now — expand statuschange example to typed ConnectionStatus
- [FINDING-001] triaged: fix-now — docs/validation.md built-in rules are generic-only, need per-signal-target
- [FINDING-009] triaged: fix-now — docs/README.md /node map incorrectly lists Fastify
- [FINDING-013] triaged: fix-now — add test:ci script to root package.json
- [FINDING-010] triaged: fix-now — update vitest-testing-plan.md fixture path
- [FINDING-011] triaged: fix-now — mark tsconfig.build.json exclusion as done in plan
- [FINDING-016] triaged: fix-now — add comment in security-regression.test.ts Issue 7
- [FINDING-021] done — PubSubMessage exported from src/types/index.ts
- [FINDING-008] done — EventStore exported from src/server/core/index.ts; api-reference.md import block updated
- [FINDING-020] done — README Invalidation Signals section replaced with discriminated union
- [FINDING-022] done — README actions table updated with GenericInvalidateSignal note + SWRSignal actions section
- [FINDING-007] done — onRevoke row added to README useReStale options table
- [FINDING-024] done — README statuschange example expanded with typed ConnectionStatus
- [FINDING-001] done — docs/validation.md built-in rules updated to cover all four signal targets
- [FINDING-009] done — docs/README.md /node entry updated, Fastify removed
- [FINDING-013] done — test:ci script added to root package.json
- [FINDING-010] done — vitest-testing-plan.md fixture path updated to src/test-fixtures/
- [FINDING-011] done — vitest-testing-plan.md tsconfig note marked as done
- [FINDING-016] done — security-regression.test.ts Issue 7 comment added
- [VERIFY] tests passed — pnpm --filter restale-kit run test:coverage
