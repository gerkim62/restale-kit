# Audit Ledger Shard: General and Meta

## Inventory Covered
- `README.md` (workspace root)
- `restale-kit/README.md` (npm-published library README)
- `docs/README.md`
- `docs/getting-started.md`
- `spec/README.md`
- `spec/folder-structure.md`
- `vitest-testing-plan.md`
- `restale-kit/vitest.config.ts`
- `restale-kit/tsconfig.build.json`
- `restale-kit/package.json` (exports map, scripts)
- `package.json` (workspace root — scripts, CI integration)
- `.github/workflows/ci.yml`
- `restale-kit/src/index-exports.test.ts`
- `restale-kit/src/security-regression.test.ts`
- `restale-kit/src/security-regression-hook.test.ts`

---

### [FINDING-007] README `useReStale` options table omits `onRevoke`

- **Area:** `restale-kit/README.md:362-371` vs `restale-kit/src/client/react/useReStale.ts:14-22` vs `docs/api-reference.md` (UseReStaleOptions section)
- **Type:** outdated-doc
- **Evidence:**
  - `restale-kit/README.md` options table lists: `onInvalidate`, `autoReconnect`, `signalSchema`, `withCredentials`, `disabled`, `reconnect.*` — no `onRevoke`.
  - `useReStale.ts:14-22`: `UseReStaleOptions` explicitly includes `onRevoke?: (reason: string) => void` with JSDoc.
  - `docs/api-reference.md` (UseReStaleOptions section): correctly documents `onRevoke`.
- **Discrepancy:** The library README's quick-reference table for `useReStale` options is incomplete — `onRevoke` is a documented, implemented option that is silently absent from the most-visible reference surface.
- **Which source is correct / should be trusted:** Implementation and `api-reference.md` are correct. The README table was not updated when `onRevoke` was added.
- **Recommended fix:** Add a row to the `useReStale` options table in `restale-kit/README.md`:
  ```
  | `onRevoke` | `(reason: string) => void` | `undefined` | Called when server sends a terminal revoke frame. |
  ```
- **Severity:** medium
- **Confidence:** high

---

### [FINDING-008] `EventStore` and `EventStoreOptions` types not exported from any public subpath

- **Area:** `restale-kit/src/server/core/index.ts`, `restale-kit/src/types/protocol.ts`, `docs/api-reference.md:133,179,186`
- **Type:** undocumented-behavior / missing-export
- **Evidence:**
  - `src/types/protocol.ts:169,177,185`: defines `EventRecord`, `EventStoreResult`, `EventStore` interfaces.
  - `src/server/core/index.ts`: exports `createEventStore` and `EventStoreOptions` — but NOT the `EventStore` interface type.
  - `src/types/index.ts`: does NOT export `EventStore`, `EventRecord`, or `EventStoreResult`.
  - `docs/api-reference.md` (restale-kit/server section): uses `EventStore<TSignal>` in `SSEChannelOptions.eventStore` and `SSEChannelGroup` constructor/property types, but never shows an import statement for it.
  - `restale-kit/package.json` exports map: no dedicated `./types` or similar subpath that would expose internal protocol types.
- **Discrepancy:** Users who want to pass a custom `eventStore` to `createSSEChannel` or `SSEChannelGroup` cannot import the `EventStore` interface to type their own implementation — it is referenced in public API signatures but not exported. Similarly `EventStoreOptions` is exported from `restale-kit/server` but not documented anywhere in the API reference.
- **Which source is correct / should be trusted:** This is a gap in both implementation (missing export) and docs (missing import example). The `EventStore` interface should be re-exported from `restale-kit/server`. `EventStoreOptions` should also be shown in the api-reference import block for `restale-kit/server`.
- **Recommended fix:**
  1. Add `export type { EventStore } from './event-store.js'` (or re-export from `protocol.ts`) in `src/server/core/index.ts`.
  2. Add `EventStore` and `EventStoreOptions` to the import example block in `docs/api-reference.md` for `restale-kit/server`.
- **Severity:** medium
- **Confidence:** high

---

### [FINDING-009] `docs/README.md` quick-orientation map lists `restale-kit/node` as usable for Express and Fastify — misleading

- **Area:** `docs/README.md:17-19`
- **Type:** outdated-doc / contradiction
- **Evidence:**
  - `docs/README.md:17-19`:
    ```
    restale-kit/node           → attachSSE  (Express, Fastify, raw Node)
    restale-kit/express        → attachSSE  (re-exports from /node)
    restale-kit/fastify        → attachSSE  (auto-calls reply.hijack() when passed Fastify objects)
    ```
  - `restale-kit/src/server/fastify/index.ts`: `attachSSE` in `/fastify` is NOT a simple re-export from `/node` — it wraps `nodeAttachSSE` with Fastify-specific `reply.hijack()` detection. Passing a Fastify `request`/`reply` pair directly to `restale-kit/node`'s `attachSSE` would fail because it only accepts `IncomingMessage`/`ServerResponse`.
- **Discrepancy:** The quick-orientation map implies `/node` works for Fastify. In practice, using `/node` with Fastify requires manually unwrapping `.raw` properties and calling `reply.hijack()` yourself. The `/fastify` subpath exists precisely to handle this. The map entry for `/node` should not list "Fastify" as a supported target.
- **Which source is correct / should be trusted:** The implementation and `docs/api-reference.md` are correct (they describe the difference). The quick-orientation map is misleading.
- **Recommended fix:** Change the `/node` description to `attachSSE (raw Node http.IncomingMessage / ServerResponse)` and remove "Fastify" from it.
- **Severity:** low
- **Confidence:** high

---

### [FINDING-010] Vitest testing plan documents a fixture path (`test/fixtures/`) that doesn't match the actual location (`src/test-fixtures/`)

- **Area:** `vitest-testing-plan.md` (Test layout section) vs `restale-kit/src/test-fixtures/`
- **Type:** outdated-doc / contradiction
- **Evidence:**
  - `vitest-testing-plan.md` (Test layout section):
    ```
    test/fixtures/{event-source,schemas,pubsub}.ts
    ```
  - Actual filesystem: `restale-kit/src/test-fixtures/event-source.ts`, `schemas.ts`, `pubsub.ts`
  - All test files import from `@/test-fixtures/...` (alias mapping to `src/`), not from any top-level `test/` directory.
- **Discrepancy:** The plan's proposed fixture path `test/fixtures/` was never adopted. Fixtures live at `src/test-fixtures/` and the implementation has settled on that layout. The plan is an aspirational/historical document rather than a description of current state.
- **Which source is correct / should be trusted:** The actual `src/test-fixtures/` location is correct. The plan text is stale.
- **Recommended fix:** Update the test layout section in `vitest-testing-plan.md` to reflect the actual `src/test-fixtures/` path. Or, if the plan is considered an archived decision record, add a note that it was superseded.
- **Severity:** low
- **Confidence:** high

---

### [FINDING-011] Vitest testing plan documents a `tsconfig.build.json` exclusion pattern it says is incomplete — but the actual file already has the correct pattern

- **Area:** `vitest-testing-plan.md` vs `restale-kit/tsconfig.build.json`
- **Type:** outdated-doc
- **Evidence:**
  - `vitest-testing-plan.md`:
    ```
    Also update `restale-kit/tsconfig.build.json`; the present exclusion only covers the old central directory:
    {
      "extends": "./tsconfig.json",
      "exclude": ["src/**/*.test.ts", "src/**/__tests__/**"]
    }
    ```
  - Actual `restale-kit/tsconfig.build.json`:
    ```json
    {
      "extends": "./tsconfig.json",
      "exclude": ["src/**/*.test.ts", "src/**/__tests__/**", "src/test-fixtures/**"]
    }
    ```
- **Discrepancy:** The plan describes a remediation that has already been applied. The `src/test-fixtures/**` exclusion is present. The plan reads as if it still needs to be done.
- **Which source is correct / should be trusted:** Implementation is correct and complete. The plan is stale on this point.
- **Recommended fix:** Mark this item as done in `vitest-testing-plan.md`, or add a note. Low urgency — the plan is an internal doc.
- **Severity:** low
- **Confidence:** high

---

### [FINDING-012] Vitest coverage config omits `src/test-fixtures/**` from `include` but vitest plan says types should NOT be excluded — config is consistent with plan; PASS

- **Area:** `restale-kit/vitest.config.ts`, `vitest-testing-plan.md`
- **Status:** PASS / Agreed
- **Notes:** `vitest.config.ts` coverage includes `src/**/*.ts` and excludes `src/**/*.test.ts` and `src/test-fixtures/**`. The testing plan explicitly says "Do not exclude `src/types/**` from coverage: `protocol.ts` and `standard-schema.ts` contain runtime code." This is correctly reflected — types are NOT excluded. No discrepancy.

---

### [FINDING-013] CI workflow runs `pnpm --filter restale-kit run test:coverage` but root `test:package` script runs `pnpm --filter restale-kit run test` (no coverage) — divergence between CI and workspace convenience script

- **Area:** `.github/workflows/ci.yml:18` vs `package.json:10`
- **Type:** contradiction
- **Evidence:**
  - `.github/workflows/ci.yml:18`: `run: pnpm --filter restale-kit run test:coverage`
  - `package.json` scripts: `"test:package": "pnpm --filter restale-kit run test && node scripts/verify-package.mjs"`
  - `restale-kit/package.json` scripts: `"test": "vitest run"` (no coverage), `"test:coverage": "vitest run --coverage"`
- **Discrepancy:** Developers running `pnpm run test:package` locally get test output without coverage data. CI always collects coverage. The workspace convenience script uses the no-coverage variant and also appends `verify-package.mjs` which CI runs as a separate step. These are not broken but they diverge — a developer trying to replicate CI locally would need to run different commands.
- **Which source is correct / should be trusted:** CI is the authoritative gate. The local `test:package` script is an approximation. This is a convenience gap, not a correctness bug.
- **Recommended fix:** Either update `test:package` to use `test:coverage` or add a `test:ci` script that mirrors the exact CI sequence. Document this in the root README's "Run tests" section. Vitest testing plan recommends this exact CI pipeline replacement.
- **Severity:** low
- **Confidence:** high

---

### [FINDING-014] `spec/folder-structure.md` table omits `createEventStore` from `restale-kit/server` entry — but this is a minor omission since it's covered by api-reference

- **Area:** `spec/folder-structure.md` (import path → source entrypoint table) vs `restale-kit/src/server/core/index.ts`
- **Type:** outdated-doc
- **Evidence:**
  - `spec/folder-structure.md` table for `restale-kit/server`: maps to `./src/server/core/` (correct entrypoint).
  - `src/server/core/index.ts`: exports `createSSEChannel`, `SSEChannelGroup`, **and `createEventStore`**.
  - The folder-structure spec only lists entrypoints, not individual exports — so this is expected. No discrepancy in purpose.
- **Status:** PASS — the spec is a path-to-entrypoint map, not an export inventory.

---

### [FINDING-015] `index-exports.test.ts` does not test `UseReStaleOptions`, `UseReStaleResult`, or `ConnectionStatus` re-exports from `restale-kit/react`

- **Area:** `restale-kit/src/index-exports.test.ts` vs `restale-kit/src/client/react/index.ts`
- **Type:** missing-test
- **Evidence:**
  - `src/client/react/index.ts`: exports `useReStale`, `UseReStaleOptions` (type), `UseReStaleResult` (type), `ConnectionStatus` (type re-export).
  - `src/index-exports.test.ts`: only checks `useReStale` is defined — type re-exports are not verifiable at runtime (they're erased), so this is expected.
  - However, the test also does not check `SWRAdapterOptions`, `SWRMutator` (types from `restale-kit/swr`) — these are runtime-invisible so this is also expected.
- **Status:** PASS — type-only exports are erased at runtime; smoke-testing them via `isDefined` is not meaningful. The index-exports test correctly covers only runtime values.

---

### [FINDING-016] Security regression test Issue 7 — multi-line JSON test is indirect / does not actually call `formatInvalidateFrame` with a real multi-line payload

- **Area:** `restale-kit/src/security-regression.test.ts` (Issue 7 describe block)
- **Type:** wrong-test
- **Evidence:**
  - The Issue 7 test for multi-line JSON manually constructs the split logic inline rather than triggering it via an actual multi-line `formatInvalidateFrame` call:
    ```ts
    const signalJson = '{"key":["part1"]}\n{"key":["part2"]}'
    const dataLines = signalJson.split(/\r\n|\r|\n/).map((line) => `data: ${line}`)
    ```
    This is testing the test author's understanding of the split logic, not the actual `formatInvalidateFrame` implementation.
  - The test comment explains why: `JSON.stringify` never emits raw newlines for standard objects, so the multi-line path cannot be reached through the public API.
  - The test then correctly verifies `formatInvalidateFrame` with a normal signal produces one `data:` line and that a custom `id` with embedded newlines is sanitised.
- **Discrepancy:** The core claim of Issue 7 ("multi-line JSON is split across `data:` lines") is not actually exercised against the real function. The test verifies the sanitisation of the ID newline injection (which is the real security concern) but the "data line splitting" portion is a dead-code path under normal operation that's tested by hand-rolling the algorithm rather than calling the function.
- **Which source is correct / should be trusted:** The implementation's newline-stripping on IDs is correct and the test for it is meaningful. The multi-line `data:` splitting test is technically correct but not a useful regression guard since the code path cannot be triggered from normal signals.
- **Recommended fix:** Add a comment in the test explicitly noting "this code path cannot be triggered via the public API since JSON.stringify never produces raw newlines; the test verifies the algorithm definition only." Alternatively, expose the split path via a test-only helper or accept the current test as documentation.
- **Severity:** low
- **Confidence:** high

---

### [FINDING-017] Agreement verification: workspace README, docs/README, getting-started, spec/README, folder-structure

- **Area:** `README.md`, `docs/README.md`, `docs/getting-started.md`, `spec/README.md`, `spec/folder-structure.md`
- **Status:** PASS / Agreed (with exceptions noted in FINDING-009)
- **Notes:**
  - Workspace README correctly describes monorepo structure, `pnpm install`, `validate`, `test:package`, and example commands.
  - `docs/getting-started.md` Express + TanStack Quick Start matches current API signatures (`attachSSE`, `SSEChannelGroup`, `useReStale`, `tanstackAdapter`). The `__restale_cid__` warning note is accurate.
  - `spec/folder-structure.md` import path → source entrypoint table is fully accurate against `package.json` exports map. All 15 subpaths match.
  - `spec/README.md` correctly lists all 4 spec documents including `folder-structure.md` (present in directory). No orphaned or missing spec files.
  - Security guidance in getting-started (metadata registration, `revokeByConnectionId` scope) is consistent with the revocation spec.

---

### [FINDING-018] Agreement verification: `index-exports.test.ts` covers all runtime exports

- **Area:** `restale-kit/src/index-exports.test.ts` vs all `*/index.ts` source files
- **Status:** PASS / Agreed
- **Notes:** The test imports and checks `isDefined` for all runtime-valued exports across all 15 subpaths. Every function/class exported at runtime is covered. Type-only exports are correctly omitted (runtime-invisible).

---

### [FINDING-019] Agreement verification: security-regression.test.ts covers all 8 documented issues (Issue 9 in separate file)

- **Area:** `restale-kit/src/security-regression.test.ts`, `restale-kit/src/security-regression-hook.test.ts`
- **Status:** PASS / Agreed
- **Notes:** Issues 1–8 are covered in `security-regression.test.ts` with clear traceability comments. Issue 9 (useReStale client orphaning) is correctly split into `security-regression-hook.test.ts` with `@vitest-environment jsdom` annotation. All 9 issues have regression coverage.
