# Audit 1 — Summary Report

**Codebase:** `sse-query-invalidator / restale-kit`
**Date:** 2026-07-17
**Auditor:** kiro AI agent

---

## What to trust / what to edit / what to build

| Source | Verdict |
|---|---|
| **spec/** | Authoritative. Fully up-to-date with implementation. |
| **docs/api-reference.md** | Mostly authoritative. One broken import claim (FINDING-021). |
| **docs/client.md, server.md, pubsub.md, getting-started.md** | Correct and consistent with spec and implementation. |
| **docs/validation.md** | Outdated — describes v0.1 flat-object validation, not v0.2 discriminated signals. |
| **restale-kit/README.md** | Partially outdated. "Invalidation Signals" section, actions table, and useReStale options table all need updates for v0.2. |
| **Implementation (src/)** | Ground truth. Consistent with spec throughout. |
| **Tests** | Good coverage. One indirect test (Issue 7 multi-line data-split). No missing test areas that aren't already noted in the vitest-testing-plan. |

**Overall assessment:** The implementation and spec are in full alignment. All drift is docs-side, caused by the v0.2 discriminated signal union not being fully reflected in the library README and `validation.md`. There are two export gaps (missing `EventStore` type, missing `PubSubMessage` type) that will cause TypeScript errors for users working with custom implementations.

---

## Findings by Severity

### 🔴 HIGH

#### FINDING-020 — README "Invalidation Signals" section shows v0.1 single-shape API
- **Shard:** `shard_cross-reference.md`
- **Type:** outdated-doc
- **Files:** `restale-kit/README.md:195-230`
- **Summary:** The `InvalidateSignal` interface shown in the npm README is the old v0.1 generic-only shape. The v0.2 discriminated union (`TanStackQuerySignal`, `SWRSignal`, `RTKQuerySignal`, `GenericInvalidateSignal`) is completely absent. The actions table also omits TanStack's `reset` and `cancel` actions.
- **Fix:** Replace the interface snippet with the full discriminated union (or a simplified summary with a reference to the api-reference). Update the actions table.

---

### 🟠 MEDIUM

#### FINDING-001 — `docs/validation.md` still documents flat-object validation rules
- **Shard:** `shard_protocol-and-types.md`
- **Type:** outdated-doc
- **Files:** `docs/validation.md:15-17`
- **Summary:** States every signal must have a `key: Array` and `action: 'invalidate'|'refetch'|'remove'`. This is correct only for `GenericInvalidateSignal`. It ignores `TanStackQuerySignal` (uses `queryKey`), `SWRSignal` (uses `key: string | JSONValue[]`, different actions), and `RTKQuerySignal` (uses `tags`).
- **Fix:** Document validation rules per signal target in `docs/validation.md`.

#### FINDING-021 — `docs/api-reference.md` claims `PubSubMessage` is importable from `'restale-kit'` — it isn't
- **Shard:** `shard_cross-reference.md`
- **Type:** outdated-doc / wrong-export-claim
- **Files:** `docs/api-reference.md:471`, `restale-kit/src/types/index.ts`
- **Summary:** The pubsub section shows `import type { PubSubMessage } from 'restale-kit'`. `PubSubMessage` is defined in `types/protocol.ts` but is not exported from `types/index.ts`. Any user copying this import gets a TypeScript error.
- **Fix:** Either add `export type { PubSubMessage }` to `src/types/index.ts`, or change the doc to import from `'restale-kit/pubsub'`.

#### FINDING-022 — README SWR actions table is wrong for `SWRSignal`
- **Shard:** `shard_cross-reference.md`
- **Type:** outdated-doc
- **Files:** `restale-kit/README.md:218-224`
- **Summary:** The actions table shows `'invalidate'`/`'refetch'`/`'remove'` for SWR. These are generic signal actions; `SWRSignal` uses `'revalidate'`/`'purge'` actions. The table conflates the generic and SWR-specific signal models.
- **Fix:** Add a note clarifying the table applies to `GenericInvalidateSignal`. Show `SWRSignal`-specific actions.

#### FINDING-007 — README `useReStale` options table omits `onRevoke`
- **Shard:** `shard_general-and-meta.md`
- **Type:** outdated-doc
- **Files:** `restale-kit/README.md:362-371`
- **Summary:** The quick-reference options table for `useReStale` lists 9 options but not `onRevoke`. The option exists in the implementation and is correctly documented in `docs/api-reference.md`. Revocation is a security-relevant feature; missing it from the README creates a discoverability gap.
- **Fix:** Add `onRevoke` row to the table.

#### FINDING-008 — `EventStore` type not exported from any public subpath
- **Shard:** `shard_general-and-meta.md`
- **Type:** undocumented-behavior / missing-export
- **Files:** `restale-kit/src/server/core/index.ts`, `restale-kit/src/types/protocol.ts`
- **Summary:** `EventStore<TSignal>` appears in `SSEChannelOptions.eventStore` and `SSEChannelGroup` constructor/property types, but users cannot import it to type their own custom event store implementation. `EventStoreOptions` is exported but undocumented.
- **Fix:** Add `export type { EventStore } from './event-store.js'` (or from `types/protocol.ts`) to `src/server/core/index.ts`. Document both `EventStore` and `EventStoreOptions` in the api-reference import block for `restale-kit/server`.

---

### 🟡 LOW

#### FINDING-009 — `docs/README.md` quick-orientation map says `restale-kit/node` works for Fastify
- **Shard:** `shard_general-and-meta.md`
- **Type:** outdated-doc
- **Files:** `docs/README.md:17-19`
- **Summary:** Map lists `restale-kit/node → attachSSE (Express, Fastify, raw Node)`. Using `/node` with Fastify requires manual `.raw` unwrapping and `reply.hijack()` — which is exactly what `/fastify` handles automatically. A developer following this hint would get broken Fastify integration.
- **Fix:** Change `/node` description to `attachSSE (raw Node http.IncomingMessage / ServerResponse)`, remove "Fastify".

#### FINDING-013 — `pnpm run test:package` and CI run different test commands
- **Shard:** `shard_general-and-meta.md`
- **Type:** contradiction
- **Files:** `package.json:10`, `.github/workflows/ci.yml:18`
- **Summary:** CI runs `test:coverage`; the local `test:package` script runs plain `test` (no coverage). Developers cannot easily replicate the exact CI run locally.
- **Fix:** Either update `test:package` to use `test:coverage`, or add a `test:ci` script that mirrors CI exactly.

#### FINDING-016 — Issue 7 (multi-line JSON) security regression test is indirect
- **Shard:** `shard_general-and-meta.md`
- **Type:** wrong-test
- **Files:** `restale-kit/src/security-regression.test.ts` (Issue 7 describe block)
- **Summary:** The multi-line data-split test hand-rolls the split algorithm rather than calling `formatInvalidateFrame` with a real multi-line input (which is unreachable via `JSON.stringify` on normal objects). The ID newline-injection sanitisation test is correct and meaningful. The data-split portion is essentially a tautology.
- **Fix:** Add a comment noting the code path is unreachable from normal signals, or accept as-is.

#### FINDING-024 — README `statuschange` example over-simplifies `ConnectionStatus`
- **Shard:** `shard_cross-reference.md`
- **Type:** outdated-doc
- **Files:** `restale-kit/README.md` (SSEInvalidatorClient section)
- **Summary:** Comment shows `// 'connecting' | 'open' | 'closed' | 'error'` as if these are bare strings. The actual type is a discriminated object union where `'closed'` carries `reason` and `'error'` carries the `error` event.
- **Fix:** Expand the snippet to show typed `ConnectionStatus` access pattern.

#### FINDING-010 — Vitest testing plan documents fixture path `test/fixtures/` that doesn't exist
- **Shard:** `shard_general-and-meta.md`
- **Type:** outdated-doc
- **Files:** `vitest-testing-plan.md`
- **Summary:** Plan shows `test/fixtures/{event-source,schemas,pubsub}.ts`; actual location is `src/test-fixtures/`. Plan is an internal historical doc, low impact.
- **Fix:** Update the test layout section in the plan, or add a note marking it superseded.

#### FINDING-011 — Vitest testing plan describes a `tsconfig.build.json` fix that was already applied
- **Shard:** `shard_general-and-meta.md`
- **Type:** outdated-doc
- **Files:** `vitest-testing-plan.md`, `restale-kit/tsconfig.build.json`
- **Summary:** Plan says the build config needs `src/test-fixtures/**` added to its exclude list; it was already added. Plan reads as pending work that is actually done.
- **Fix:** Mark as done in the plan.

---

### ✅ PASS — Areas verified as consistent

These areas were fully audited and found to agree across spec, docs, implementation, and tests:

| Area | Shard |
|---|---|
| Wire protocol types (`InvalidateSignal` union, `JSONValue`, `SIGNAL_TARGETS`) | `shard_protocol-and-types.md` |
| Standard Schema validation (`validateStandardSchema`, sync-only enforcement) | `shard_protocol-and-types.md` |
| Key matching logic (`matchesInvalidateSignalKey` — prefix, exact, object-subset) | `shard_protocol-and-types.md` |
| Error classes (`ChannelClosedError`, `SchemaValidationError`) | `shard_protocol-and-types.md` |
| Utility functions (`generateUUID`, `appendQueryParam`, constants) | `shard_protocol-and-types.md` |
| Server core: `createSSEChannel`, keepalive, schema validation, framing | `shard_server-core.md` |
| Server core: `EventStore` ring buffer, `getEventsAfter` stale detection | `shard_server-core.md` |
| Server core: `SSEChannelGroup` (all methods including revocation, topics, control) | `shard_server-core.md` |
| Server core: `transport-utils` (connectionId extraction, Last-Event-ID length guard) | `shard_server-core.md` |
| Server adapters: Node, Express, Fastify, Fetch, Hono | `shard_server-adapters.md` |
| E2E transport tests covering all 5 adapters | `shard_server-adapters.md` |
| SSE client: connect/reconnect/backoff/status machine | `shard_client.md` |
| `useReStale` React hook: mount/unmount/disabled/concurrent mode safety | `shard_client.md` |
| `tanstackAdapter`/`useTanstackQueryAdapter`: all 5 TanStack actions | `shard_client.md` |
| `swrAdapter`/`useSwrAdapter`: revalidate/purge/remove, key conversion | `shard_client.md` |
| PubSub contract, encryption, AAD binding | `shard_pubsub.md` |
| Redis adapter: duplicate suppression, self-echo, subscribe/unsubscribe | `shard_pubsub.md` |
| Ably adapter: native echo suppression, origin tag | `shard_pubsub.md` |
| Pusher adapter: webhook signature verification, dispatch | `shard_pubsub.md` |
| `index-exports.test.ts`: all 15 subpath runtime exports covered | `shard_general-and-meta.md` |
| Security regression tests 1–9: all covered, correctly specified | `shard_general-and-meta.md` |
| All 15 package.json export subpaths match spec/folder-structure and source | `shard_cross-reference.md` |
| CHANGELOG v0.2.0 matches implementation | `shard_cross-reference.md` |
| RTK Query is a wire-protocol-only type; no shipped adapter (by design) | `shard_cross-reference.md` |
| `vitest.config.ts`: coverage inclusion/exclusion matches testing plan intent | `shard_general-and-meta.md` |
| CI workflow: correct sequence, no duplicate test runs | `.github/workflows/ci.yml` |

---

## Complete Finding Index

| ID | Title | Severity | Type | Fix target |
|---|---|---|---|---|
| FINDING-001 | `docs/validation.md` describes flat-object rules only | medium | outdated-doc | `docs/validation.md` |
| FINDING-002 | Protocol types, schema validation, key matching all agree | — | PASS | — |
| FINDING-003 | Server core architecture fully agrees | — | PASS | — |
| FINDING-004 | Server adapter integrations fully agree | — | PASS | — |
| FINDING-005 | Client core, React hook, backoff, adapters all agree | — | PASS | — |
| FINDING-006 | PubSub contract, encryption, adapters all agree | — | PASS | — |
| FINDING-007 | README `useReStale` table missing `onRevoke` | medium | outdated-doc | `restale-kit/README.md` |
| FINDING-008 | `EventStore` type not exported from any public subpath | medium | missing-export | `src/server/core/index.ts`, `docs/api-reference.md` |
| FINDING-009 | docs/README quick-map says `/node` works for Fastify | low | outdated-doc | `docs/README.md` |
| FINDING-010 | Vitest plan uses wrong fixture path `test/fixtures/` | low | outdated-doc | `vitest-testing-plan.md` |
| FINDING-011 | Vitest plan describes build exclusion already applied | low | outdated-doc | `vitest-testing-plan.md` |
| FINDING-012 | Coverage config matches plan — PASS | — | PASS | — |
| FINDING-013 | `test:package` and CI use different test commands | low | contradiction | `package.json` |
| FINDING-014 | spec/folder-structure doesn't list individual exports — by design, PASS | — | PASS | — |
| FINDING-015 | index-exports test correctly omits type-only exports — PASS | — | PASS | — |
| FINDING-016 | Issue 7 multi-line JSON test is indirect/tautological | low | wrong-test | `security-regression.test.ts` |
| FINDING-017 | workspace README, docs/README, getting-started, spec/README all agree | — | PASS | — |
| FINDING-018 | index-exports test covers all runtime exports — PASS | — | PASS | — |
| FINDING-019 | Security regression tests cover all 9 issues — PASS | — | PASS | — |
| FINDING-020 | README shows v0.1 single-shape `InvalidateSignal` | **high** | outdated-doc | `restale-kit/README.md` |
| FINDING-021 | `PubSubMessage` not exported from `restale-kit` root | medium | wrong-export-claim | `src/types/index.ts`, `docs/api-reference.md` |
| FINDING-022 | README SWR actions table wrong for `SWRSignal` | medium | outdated-doc | `restale-kit/README.md` |
| FINDING-023 | FINDING-001 and FINDING-020 share root cause (v0.2 underdoc) | — | pattern-note | — |
| FINDING-024 | README statuschange example over-simplifies `ConnectionStatus` | low | outdated-doc | `restale-kit/README.md` |
| FINDING-025 | All 15 export subpaths match spec and source — PASS | — | PASS | — |
| FINDING-026 | CHANGELOG v0.2.0 matches implementation — PASS | — | PASS | — |

---

## Recommended fix priority

1. **FINDING-020** (README Invalidation Signals — high, most-visible user-facing gap)
2. **FINDING-021** (PubSubMessage not exported — will cause TS errors for custom adapters)
3. **FINDING-008** (EventStore not exported — will cause TS errors for custom event stores)
4. **FINDING-001 + FINDING-022 + FINDING-023** (docs/validation.md + README SWR table — same root cause, fix in one pass)
5. **FINDING-007** (README missing `onRevoke` — discoverability of a security-relevant feature)
6. Low-severity findings (009, 013, 024) — address opportunistically during README refresh
7. FINDING-010, FINDING-011, FINDING-016 — internal/test-only docs, low urgency
