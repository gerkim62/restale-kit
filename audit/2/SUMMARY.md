# Audit 2 — Summary Report

**Focus:** Frame Guard across spec, docs, implementation, and tests.
**Shards:** 5 (see `00_INDEX.md` for the full list)

---

## What to trust / what to edit / what to build

| Layer | Verdict |
|---|---|
| **Spec** (Frame Guard) | Authoritative. `restale-kit-frame-guard-spec (7).md` and the usage matrix are well-specified and internally consistent. One minor wording issue (FG-05 jitter direction). |
| **Spec** (main contract) | Stale. `sse-query-invalidate-contract.md` was not updated for Frame Guard. Missing: `SSEChannelOptions` fields, `SSEChannel.requestedTarget`, `SSEChannelGroup.channelDefaults`, Frame Guard type exports, `renew` event in event map, client validation pipeline for non-generic signals. |
| **Implementation** | Largely correct. One structural gap (FG-01: `channelDefaults` stored but not applied). One minor expression issue (FG-02). One `retryDelayMs` floor inconsistency for non-default configs (FC-04). |
| **Docs** | Critical gap. The entire Frame Guard feature is absent from user-facing docs. `docs/server.md` needs a full Frame Guard section. `docs/client.md` needs the `renew` event, `{ reason: 'deadline' }` revoke, and deadline-reconnect lifecycle. |
| **Tests** | Strong for Frame Guard mechanics. Key gap: `channelDefaults` behavioral tests (FT-03) are blocked by FG-01. Two test comments are factually wrong about the implementation (FT-01, FT-02). Several minor coverage gaps (FT-04–FT-07). |

---

## Findings by severity

### Critical

| ID | Title | Shard |
|---|---|---|
| **FD-01** | `docs/server.md` has zero coverage of Frame Guard (`lifetime`, `beforeFrame`, `guardKeepalive`, `channelDefaults`) | `shard_frame-guard-docs.md` |

### High

| ID | Title | Shard |
|---|---|---|
| **FG-01** | `mergeChannelDefaults` is implemented and exported but never called — group `channelDefaults` never reach channels | `shard_frame-guard-spec-vs-impl.md` |
| **FD-02** | `docs/client.md` has no coverage of the `renew` event, confirmatory reconnect, or `{ reason: 'deadline' }` revoke | `shard_frame-guard-docs.md` |
| **FT-03** | `channelDefaults` tests only cover storage, not behavioral propagation (downstream of FG-01) | `shard_frame-guard-tests.md` |

### Medium

| ID | Title | Shard |
|---|---|---|
| **FG-03** | `spec/sse-query-invalidate-contract.md` `SSEChannelOptions` missing all Frame Guard fields (`lifetime`, `beforeFrame`, `guardKeepalive`, `requestedTarget`) | `shard_frame-guard-spec-vs-impl.md` |
| **FG-04** | `spec/sse-query-invalidate-contract.md` `SSEChannelGroup` constructor options missing `channelDefaults` | `shard_frame-guard-spec-vs-impl.md` |
| **FC-03** | `renew` event is in `SSEInvalidatorClientEventMap` and client-contracts but absent from `docs/client.md` | `shard_frame-guard-client.md` |
| **FD-03** | `docs/server.md` `SSEChannelGroup` constructor options table missing `channelDefaults` row | `shard_frame-guard-docs.md` |
| **FD-04** | Usage-matrix §7 explicit recommendation to pair `eventStore` + `onDeadline: 'reconnect'` not propagated to docs | `shard_frame-guard-docs.md` |
| **GC-01** | Client validation pipeline in contract spec describes generic signals only — TanStackQuerySignal / RTKQuerySignal don't have `key` | `shard_general-contract.md` |
| **GC-03** | Contract spec exported type surface missing Frame Guard types (`LifetimeOptions`, `OnDeadline`, `FrameGuardResult`, etc.) | `shard_general-contract.md` |
| **GC-04** | Contract spec `SSEInvalidatorClientEventMap` missing `renew` event | `shard_general-contract.md` |
| **FT-02** | Test comment for "missing maxAttempts" describes a non-existent implementation violation — misleads future developers | `shard_frame-guard-tests.md` |

### Low

| ID | Title | Shard |
|---|---|---|
| **FG-02** | `resolveLifetimeMs` uses `connectedAt + ttlMs - connectedAt` (= ttlMs) — misleading expression | `shard_frame-guard-spec-vs-impl.md` |
| **FG-05** | Spec says deadline jitter is "before or after"; implementation is positive-only (after) | `shard_frame-guard-spec-vs-impl.md` |
| **FG-06** | Schema validation runs before `beforeFrame` — ordering undocumented in spec and docs | `shard_frame-guard-spec-vs-impl.md` |
| **FG-07** | `invalidate()` throws `ChannelClosedError` when `beforeFrame` returns `close` — not documented in contract | `shard_frame-guard-spec-vs-impl.md` |
| **FG-08** | `mergeChannelDefaults` and `ChannelDefaults` exported from `server/core/index.ts` but absent from exports table | `shard_frame-guard-spec-vs-impl.md` |
| **FG-09** | `SSEChannel.requestedTarget` in contract spec missing (and implementation widens type to `string` vs spec's `SignalTarget`) | `shard_frame-guard-spec-vs-impl.md` |
| **FC-01** | Test comment incorrectly says implementation "substitutes 1" for `maxAttempts: 0` — it actually falls to hard-revoke | `shard_frame-guard-client.md` |
| **FC-04** | `DEADLINE_MIN_FIRE_DELAY_MS` constant ignores configured `retryDelayMs` when deadline is already past at creation — spec says use the configured value | `shard_frame-guard-client.md` |
| **FC-05** | `Exclude<string, 'unsupported-target'>` in `RevokeEventDetail` is a TypeScript no-op — doesn't narrow as intended | `shard_frame-guard-client.md` |
| **FD-05** | `docs/client.md` `connect()` table missing `closed (revoked)` row | `shard_frame-guard-docs.md` |
| **FD-06** | `docs/server.md` adapter examples only show `{ target }` — no other SSEChannelOptions fields visible | `shard_frame-guard-docs.md` |
| **FT-01** | Test comment for `maxAttempts: 0` is factually wrong (implementation rejects, not floors) | `shard_frame-guard-tests.md` |
| **FT-04** | No test for `guardKeepalive: true` + `beforeFrame` + `keepaliveIntervalMs: 0` (default) = guard never invoked | `shard_frame-guard-tests.md` |
| **FT-05** | No test for `onDeadline` object with only one field set (other uses spec default) | `shard_frame-guard-tests.md` |
| **FT-06** | No test verifying `beforeFrame.close` does NOT take the `renew` path even when `onDeadline: 'reconnect'` | `shard_frame-guard-tests.md` |
| **FT-07** | No test for `ctx.isResume` with `lastEventId` but no `eventStore` | `shard_frame-guard-tests.md` |
| **FT-08** | Test comment advance-time value (2000ms) doesn't match the stated calculation (250ms) | `shard_frame-guard-tests.md` |
| **GC-02** | `connectionId` JSDoc says "rarely need to set manually" without explaining when manual use is appropriate | `shard_general-contract.md` |
| **GC-05** | `broadcastByKey` docs say "matches or extends" — slightly imprecise vs spec's wrapping semantics | `shard_general-contract.md` |
| **GC-06** | Revocation spec doesn't mention Frame Guard's `onDeadline: 'revoke'` / `beforeFrame.close` as additional revocation paths | `shard_general-contract.md` |
| **GC-07** | `RENEW_JITTER_FACTOR` is client-only semantics but lives in server-shared `FRAME_GUARD_DEFAULTS` — no comment explaining this | `shard_general-contract.md` |

---

## Recommended action order

1. **Fix FG-01** (channelDefaults not propagated) — this is the only functional gap in the Frame Guard implementation. Without it, the `channelDefaults` feature is a no-op at runtime despite being fully implemented in isolation.

2. **Write FD-01** (docs/server.md Frame Guard section) — Frame Guard is invisible to all users. This is the highest-impact documentation action.

3. **Write FD-02** (docs/client.md renew/deadline section) — users who hit deadline-driven reconnects get `{ reason: 'deadline' }` on their revoke event with zero documentation context.

4. **Fix FT-02 and FT-01** (misleading test comments) — a developer reading these will waste time on a nonexistent bug.

5. **Update spec/sse-query-invalidate-contract.md** (FG-03, FG-04, FG-08, FG-09, GC-03, GC-04) — as a batch, bring the main contract spec up to date with Frame Guard additions.

6. **Add FT-03 behavioral tests** once FG-01 is fixed — storage-only tests give false confidence in channelDefaults.

7. **Remaining low items** at discretion — most are wording/type precision improvements with no runtime impact.
