# Audit Ledger Shard: Cross-Reference

## Purpose
This shard captures discrepancies discovered by cross-referencing findings across shards — patterns that affect multiple files or that only become visible when comparing sources side-by-side.

## Files re-examined
- `restale-kit/README.md` (🎯 Invalidation Signals section)
- `docs/api-reference.md` (pubsub section)
- `restale-kit/src/types/index.ts`
- `restale-kit/src/types/protocol.ts`
- All prior shards for pattern matching

---

### [FINDING-020] README "Invalidation Signals" section presents the legacy generic-only `InvalidateSignal` shape as if it's the complete API — omits discriminated union introduced in v0.2

- **Area:** `restale-kit/README.md:195-230` vs `restale-kit/src/types/protocol.ts`, `spec/sse-query-invalidate-contract.md`, `docs/api-reference.md`
- **Type:** outdated-doc
- **Evidence:**
  - `restale-kit/README.md:195-200` (Invalidation Signals section):
    ```ts
    interface InvalidateSignal {
      key: JSONValue[]                              // hierarchical key
      exact?: boolean                              // default false = prefix match
      action?: 'invalidate' | 'refetch' | 'remove' // default 'invalidate'
    }
    ```
  - Actual type (since v0.2, per `CHANGELOG.md`):
    ```ts
    type InvalidateSignal =
      | TanStackQuerySignal    // { target: 'tanstack-query', queryKey, exact?, type?, action?, stale? }
      | SWRSignal              // { target: 'swr', key, action?, revalidate?, match? }
      | RTKQuerySignal         // { target: 'rtk-query', tags: [...] }
      | GenericInvalidateSignal // { target?: 'generic', key: JSONValue[], exact?, action? }
    ```
  - `spec/sse-query-invalidate-contract.md`: full discriminated union with all four targets.
  - The README actions table also only shows three actions (`invalidate`, `refetch`, `remove`) but TanStack supports `reset` and `cancel` as well.
- **Discrepancy:** The README is the primary user-facing document (also published to npm). It still shows the v0.1 single-shape `InvalidateSignal` instead of the v0.2 discriminated union. Any user reading only the README will be unaware of `TanStackQuerySignal.queryKey`, `SWRSignal`, target-discriminated routing, `reset`/`cancel` TanStack actions, or `RTKQuerySignal`. This is the most visible documentation gap in the entire codebase.
- **Which source is correct / should be trusted:** Implementation, spec, and `docs/api-reference.md` are correct. The README is stale.
- **Recommended fix:**
  1. Replace the single-shape interface in the "Invalidation Signals" section with the actual discriminated union (or at minimum show the generic shape with a note pointing to the full union in `api-reference.md`).
  2. Expand the actions table to include `reset` and `cancel` for TanStack Query.
  3. Add a brief section on `SWRSignal` actions (`revalidate`, `purge`, `remove`).
- **Severity:** high
- **Confidence:** high

---

### [FINDING-021] `docs/api-reference.md` shows `PubSubMessage` as importable from `'restale-kit'` (root) — but it is not exported there

- **Area:** `docs/api-reference.md:471` vs `restale-kit/src/types/index.ts`
- **Type:** outdated-doc / wrong-export-claim
- **Evidence:**
  - `docs/api-reference.md:471`:
    ```ts
    import type { PubSubMessage, JSONValue, InvalidateSignal } from 'restale-kit'
    ```
  - `restale-kit/src/types/index.ts`: exports `JSONValue`, `InvalidateSignal` — but NOT `PubSubMessage`.
  - `restale-kit/src/types/protocol.ts:157`: defines `PubSubMessage` but it is not re-exported in `types/index.ts`.
  - `restale-kit/package.json` exports map: no subpath exposes `PubSubMessage` publicly.
- **Discrepancy:** A user who copies the import example from the api-reference will get a TypeScript "Module 'restale-kit' has no exported member 'PubSubMessage'" error. `PubSubMessage` is referenced in the `PubSubAdapter` interface signature but users cannot import it.
- **Which source is correct / should be trusted:** Implementation (types/index.ts) is the ground truth. The docs are wrong.
- **Recommended fix:** Either:
  1. Add `export type { PubSubMessage } from './protocol.js'` to `src/types/index.ts`, OR
  2. Change the api-reference import example to `import type { PubSubMessage } from 'restale-kit/pubsub'` if there's a reason to keep it off the root, OR
  3. Export it from `restale-kit/pubsub/core/index.ts` and update the doc accordingly.
  Option 1 is simplest. `PubSubMessage` is already present in `types/protocol.ts` alongside `InvalidateSignal`.
- **Severity:** medium
- **Confidence:** high

---

### [FINDING-022] README actions table for SWR is incomplete — shows only `invalidate`/`refetch`/`remove` but SWR adapter handles `revalidate`/`purge` action values

- **Area:** `restale-kit/README.md:218-224` vs `restale-kit/src/client/swr/adapter.ts`
- **Type:** outdated-doc
- **Evidence:**
  - `restale-kit/README.md` actions table:
    | `action` | SWR |
    |---|---|
    | `'invalidate'` (default) | `mutate(filter)` |
    | `'refetch'` | `mutate(filter)` |
    | `'remove'` | `mutate(filter, undefined, false)` |
  - SWR adapter implementation: handles `SWRSignal` with `action: 'revalidate' | 'purge'` — not `invalidate`/`refetch`/`remove`. The table is only accurate for `GenericInvalidateSignal`-style signals routed to SWR.
  - `docs/api-reference.md` (SWR section): correctly documents `SWRSignal` with `action?: 'revalidate' | 'purge'` and `revalidate?: boolean`.
- **Discrepancy:** The README actions table conflates the SWR adapter's behavior with the generic signal actions. SWR's native signal type (`SWRSignal`) uses `'revalidate'`/`'purge'` actions, not `'invalidate'`/`'refetch'`/`'remove'`. The table is misleading for SWR users.
- **Which source is correct / should be trusted:** `api-reference.md` and the `SWRSignal` type definition are correct.
- **Recommended fix:** Add a note to the README actions table clarifying it applies to `GenericInvalidateSignal` only, and point SWR-specific users to the `SWRSignal` type for native action mapping.
- **Severity:** medium
- **Confidence:** high

---

### [FINDING-023] Cross-shard: FINDING-001 (docs/validation.md) and FINDING-020 (README) share the same root cause — docs were not updated when target-discriminated signals were added in v0.2

- **Area:** `docs/validation.md`, `restale-kit/README.md`
- **Type:** pattern-note (cross-reference)
- **Evidence:** See FINDING-001 (`shard_protocol-and-types.md`) and FINDING-020 (this shard).
- **Notes:** Both findings stem from the same v0.2 upgrade that introduced the discriminated signal union. The `validation.md` still describes the old flat-object validation rules; the README's "Invalidation Signals" section still shows the old single-shape interface. A single documentation update pass covering the v0.2 signal model changes would fix both.
- **Severity:** n/a (tracking note)
- **Confidence:** high

---

### [FINDING-024] `connectionStatus` 'error' type documented in `docs/api-reference.md` differs subtly from what the README shows

- **Area:** `restale-kit/README.md`, `docs/api-reference.md`, `restale-kit/src/client/core/client-contracts.ts`
- **Type:** potential-contradiction
- **Evidence:**
  - `restale-kit/README.md` (SSEInvalidatorClient statuschange listener):
    ```ts
    console.log(event.detail.status) // 'connecting' | 'open' | 'closed' | 'error'
    ```
  - `docs/api-reference.md` (ConnectionStatus type):
    ```ts
    type ConnectionStatus =
      | { status: 'connecting' }
      | { status: 'open' }
      | { status: 'closed'; reason: 'manual' | 'unmount' | 'revoked' }
      | { status: 'error'; error: Event }
    ```
  - Implementation `client-contracts.ts`: matches `api-reference.md` exactly.
- **Discrepancy:** The README comment simplifies the status to a bare string union, giving no indication that `'closed'` carries a `reason` or `'error'` carries an `error` property. A user relying only on the README would not know to check `event.detail.reason` on close or `event.detail.error` on error.
- **Which source is correct / should be trusted:** `api-reference.md` and implementation are correct. The README is an over-simplified illustration.
- **Recommended fix:** Expand the statuschange example in the README to show `event.detail` as the typed `ConnectionStatus` object rather than just `.status`.
- **Severity:** low
- **Confidence:** high

---

### [FINDING-025] Agreement verification: all 15 package.json export subpaths match spec/folder-structure.md and actual source entrypoints

- **Area:** `restale-kit/package.json` exports map, `spec/folder-structure.md`, `restale-kit/src/**/index.ts`
- **Status:** PASS / Agreed
- **Notes:** All 15 subpath exports (`.`, `/server`, `/node`, `/express`, `/fastify`, `/fetch`, `/hono`, `/client`, `/react`, `/swr`, `/tanstack-query`, `/pubsub`, `/redis`, `/ably`, `/pusher`) correctly map to their source entrypoints. The spec folder-structure table matches. No orphaned exports, no missing entries.

---

### [FINDING-026] Agreement verification: CHANGELOG v0.2.0 matches implementation

- **Area:** `restale-kit/CHANGELOG.md`, `restale-kit/src/`
- **Status:** PASS / Agreed
- **Notes:** CHANGELOG v0.2.0 documents: target-discriminated signal union, `SIGNAL_TARGETS` export, `revokeWhere`/`revokeByConnectionId` API, `SSEChannelGroup` constructor options (`controlTopic`, `metaSchema`, `pubsub`, `eventStore`/`eventBufferCapacity`), `useSwrAdapter`, `useTanstackQueryAdapter`. All are present in implementation.
