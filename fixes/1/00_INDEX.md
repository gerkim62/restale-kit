# Fixes 1 — Index

**Addresses audit:** `audit/1/`
**Date started:** 2026-07-17
**Agent:** kiro

---

## Grouping rationale

Fixes are grouped by *target file / area* (mirroring audit shard organisation), except the two
export-gap fixes (FINDING-021, FINDING-008) which are grouped together because they are the same
type of change (missing `export type`). The README refresh batches all three README findings
(FINDING-020, FINDING-022, FINDING-007, FINDING-024) into one pass so related sections stay
coherent.

---

## Fix Batches

| Batch file | Findings | Scope | Status |
|---|---|---|---|
| `batch_exports.md` | FINDING-021, FINDING-008 | Add missing `export type` statements to `src/types/index.ts` and `src/server/core/index.ts`; update `docs/api-reference.md` import block | done |
| `batch_readme-refresh.md` | FINDING-020, FINDING-022, FINDING-007, FINDING-024 | `restale-kit/README.md` — discriminated signal union, SWR actions table, `onRevoke` row, typed `ConnectionStatus` example | done |
| `batch_docs-validation.md` | FINDING-001, FINDING-023 | `docs/validation.md` built-in structural validation rules, per-signal-target | done |
| `batch_docs-readme.md` | FINDING-009 | `docs/README.md` quick-orientation map — remove Fastify from `/node` entry | done |
| `batch_meta.md` | FINDING-013, FINDING-010, FINDING-011, FINDING-016 | `package.json` `test:ci` script; `vitest-testing-plan.md` fixture path + tsconfig note; security-regression test comment | done |
