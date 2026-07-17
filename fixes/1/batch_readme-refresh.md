# Batch: README Refresh (FINDING-020, FINDING-022, FINDING-007, FINDING-024)

**Audit shards:** `shard_cross-reference.md`, `shard_general-and-meta.md`

---

### [FINDING-020] README "Invalidation Signals" section shows v0.1 single-shape API

- **Audit source:** `shard_cross-reference.md`
- **Triage decision:** fix-now
- **Reasoning:** Most visible documentation gap — the npm README showed a legacy single-shape `InvalidateSignal` interface. Every user reading only the README would be unaware of `target`-discriminated signals, `TanStackQuerySignal.queryKey`, SWR-native actions, or the `reset`/`cancel` TanStack actions.
- **Change made:** `restale-kit/README.md` — replaced the "Invalidation Signals" section. The old single `interface InvalidateSignal` block was replaced with the full discriminated union (all four targets). Added three separate actions tables: one for `GenericInvalidateSignal` (with `invalidate`/`refetch`/`remove`), one for `TanStackQuerySignal` (all 5 actions including `reset`/`cancel`), and one for `SWRSignal` (`revalidate`/`purge`). Added a cross-reference to api-reference.md.
- **Tests:** No behavioural test needed — this is a documentation change. TypeScript typecheck covers any type-related regressions.
- **Status:** done
- **Follow-ups:** FINDING-022 (SWR actions table) was addressed within this same fix — see below.

---

### [FINDING-022] README SWR actions table wrong for `SWRSignal`

- **Audit source:** `shard_cross-reference.md`
- **Triage decision:** fix-now — resolved as part of FINDING-020 rewrite
- **Reasoning:** The old actions table conflated `GenericInvalidateSignal` actions with `SWRSignal` actions. Rather than patch the old table, the full section rewrite naturally produced three correctly scoped tables.
- **Change made:** Resolved by FINDING-020 fix — the new `SWRSignal` actions section shows `'revalidate'` and `'purge'` only; the `GenericInvalidateSignal` table explicitly labels itself.
- **Tests:** None needed.
- **Status:** done
- **Follow-ups:** None.

---

### [FINDING-007] README `useReStale` options table omits `onRevoke`

- **Audit source:** `shard_general-and-meta.md`
- **Triage decision:** fix-now
- **Reasoning:** `onRevoke` is a security-relevant option (server-initiated connection termination). Missing it from the quick-reference table reduces discoverability and is a gap against the `api-reference.md` and implementation.
- **Change made:** `restale-kit/README.md` — added `onRevoke` row immediately after `onInvalidate` (most visible location): `| \`onRevoke\` | \`(reason: string) => void\` | \`undefined\` | Called when the server sends a terminal revoke frame. The connection will NOT auto-reconnect. |`
- **Tests:** None needed.
- **Status:** done
- **Follow-ups:** None.

---

### [FINDING-024] README `statuschange` example over-simplifies `ConnectionStatus`

- **Audit source:** `shard_cross-reference.md`
- **Triage decision:** fix-now
- **Reasoning:** The old comment `// 'connecting' | 'open' | 'closed' | 'error'` gives no indication that `'closed'` carries a `reason` field or `'error'` carries an `error` event. Users building status UIs would not know to handle these.
- **Change made:** `restale-kit/README.md` — replaced the one-liner `console.log(event.detail.status)` with a full discriminated-union switch pattern showing `status.reason` on `'closed'` and `status.error` on `'error'`, with a comment labelling `event.detail` as `ConnectionStatus`.
- **Tests:** None needed.
- **Status:** done
- **Follow-ups:** None.
