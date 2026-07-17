# Fixes 1 — Summary Report

**Audit addressed:** `audit/1/`
**Date completed:** 2026-07-17
**Agent:** kiro

---

## Counts by status

| Status | Count |
|---|---|
| ✅ Fixed | 10 |
| ⏭️ Resolved as pattern-note (no change needed) | 1 (FINDING-023) |
| 🚫 Deferred | 0 |
| ❌ Rejected | 0 |
| 🔴 Needs human decision | 0 |
| **Total actionable** | **10** |

## Counts by severity

| Severity | Total | Fixed |
|---|---|---|
| 🔴 HIGH | 1 | 1 |
| 🟠 MEDIUM | 4 | 4 |
| 🟡 LOW | 5 | 5 |

---

## Findings fixed

| ID | Title | Severity | Files changed |
|---|---|---|---|
| FINDING-020 | README shows v0.1 `InvalidateSignal` shape | HIGH | `restale-kit/README.md` |
| FINDING-021 | `PubSubMessage` not exported from root | MEDIUM | `restale-kit/src/types/index.ts` |
| FINDING-008 | `EventStore` type not exported from server subpath | MEDIUM | `restale-kit/src/server/core/index.ts`, `docs/api-reference.md` |
| FINDING-001 | `docs/validation.md` built-in rules generic-only | MEDIUM | `docs/validation.md` |
| FINDING-022 | README SWR actions table wrong | MEDIUM | `restale-kit/README.md` (part of FINDING-020 rewrite) |
| FINDING-007 | README `useReStale` table missing `onRevoke` | MEDIUM* | `restale-kit/README.md` |
| FINDING-009 | `docs/README.md` `/node` map lists Fastify | LOW | `docs/README.md` |
| FINDING-013 | `test:package` and CI use different commands | LOW | `package.json`, `README.md` |
| FINDING-024 | README `statuschange` example over-simplified | LOW | `restale-kit/README.md` |
| FINDING-010 | Vitest plan uses wrong fixture path | LOW | `vitest-testing-plan.md` |
| FINDING-011 | Vitest plan tsconfig fix not marked done | LOW | `vitest-testing-plan.md` |
| FINDING-016 | Issue 7 test missing unreachability comment | LOW | `restale-kit/src/security-regression.test.ts` |
| FINDING-023 | Cross-shard pattern note (shared root cause) | — | no change (resolved by 001 + 020) |

\* Audit listed FINDING-007 as medium; SUMMARY listed it as medium. Treated as medium.

---

## Verification

`pnpm --filter restale-kit run test:coverage` — **29 test files, 319 tests passed, exit 0.**

---

## Files modified

| File | Finding(s) |
|---|---|
| `restale-kit/src/types/index.ts` | FINDING-021 |
| `restale-kit/src/server/core/index.ts` | FINDING-008 |
| `restale-kit/README.md` | FINDING-020, FINDING-022, FINDING-007, FINDING-024 |
| `docs/api-reference.md` | FINDING-008 |
| `docs/validation.md` | FINDING-001 |
| `docs/README.md` | FINDING-009 |
| `package.json` | FINDING-013 |
| `README.md` (workspace root) | FINDING-013 |
| `vitest-testing-plan.md` | FINDING-010, FINDING-011 |
| `restale-kit/src/security-regression.test.ts` | FINDING-016 |

---

## New findings surfaced during fixing

None. All fixes were contained within their audit-identified scope. No additional discrepancies were discovered.

---

## Items still needing human decision

None.

---

## Notes

- FINDING-022 was resolved within the FINDING-020 rewrite (the invalidation signals section was replaced wholesale, producing separate per-signal-target action tables rather than a patched generic table).
- The `test:ci` script was added as a new name rather than mutating `test:package`, to preserve the no-overhead convenience variant for developers who don't need coverage output locally.
- `EventStoreOptions` was already exported from `restale-kit/server` prior to this fix but was undocumented; the api-reference.md update now surfaces it in the import block.
