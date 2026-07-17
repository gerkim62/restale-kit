# Batch: docs/validation.md (FINDING-001, FINDING-023)

**Audit shards:** `shard_protocol-and-types.md`, `shard_cross-reference.md`

---

### [FINDING-001] `docs/validation.md` built-in structural validation rules are generic-only

- **Audit source:** `shard_protocol-and-types.md`
- **Triage decision:** fix-now
- **Reasoning:** The built-in validation section described rules for `GenericInvalidateSignal` only (`key: Array`, `action: 'invalidate'|'refetch'|'remove'`). This is incorrect for `TanStackQuerySignal` (uses `queryKey`, supports `reset`/`cancel`), `SWRSignal` (uses `key: string|Array`, actions are `revalidate`/`purge`), and `RTKQuerySignal` (uses `tags`). Users reading this section for SWR or TanStack would get wrong expectations.
- **Change made:** `docs/validation.md` — replaced the old 6-point flat-list with a per-signal-target breakdown. Each target now has its own bullet with the correct required fields and allowed action values. The surrounding structure (shared rules 1–2 and the unknown-fields note) was preserved.
- **Tests:** None needed — documentation change.
- **Status:** done
- **Follow-ups:** None.

---

### [FINDING-023] Cross-shard pattern note: FINDING-001 and FINDING-020 share root cause

- **Audit source:** `shard_cross-reference.md`
- **Triage decision:** resolved — pattern-note only, no separate code change
- **Reasoning:** Both findings were caused by the v0.2 discriminated signal union not being reflected in docs. Fixing FINDING-001 (validation.md) and FINDING-020 (README) in the same pass closed the pattern. No additional file needs to change.
- **Status:** done (resolved by FINDING-001 + FINDING-020 fixes)
- **Follow-ups:** None.
