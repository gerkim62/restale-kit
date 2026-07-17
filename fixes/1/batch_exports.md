# Batch: Export Gaps (FINDING-021, FINDING-008)

**Audit shards:** `shard_cross-reference.md`, `shard_general-and-meta.md`

---

### [FINDING-021] `PubSubMessage` not exported from `restale-kit` root

- **Audit source:** `shard_cross-reference.md`
- **Triage decision:** fix-now
- **Reasoning:** Any user copying `import type { PubSubMessage } from 'restale-kit'` from api-reference.md gets a TypeScript error. Simplest fix: add export in `src/types/index.ts` where `InvalidateSignal` already lives.
- **Change made:** `restale-kit/src/types/index.ts` — added `PubSubMessage` to the `export type { ... } from './protocol.js'` block.
- **Tests:** No new test needed; `index-exports.test.ts` only checks runtime values (type exports are erased). TypeScript typecheck will catch regressions.
- **Status:** done
- **Follow-ups:** None.

---

### [FINDING-008] `EventStore` type not exported from any public subpath

- **Audit source:** `shard_general-and-meta.md`
- **Triage decision:** fix-now
- **Reasoning:** Users passing a custom `eventStore` to `createSSEChannel` or `SSEChannelGroup` cannot type their implementation. `EventStoreOptions` was already exported but undocumented; `EventStore`, `EventRecord`, and `EventStoreResult` were missing entirely.
- **Change made:**
  1. `restale-kit/src/server/core/index.ts` — added `export type { EventStore, EventRecord, EventStoreResult } from '../../types/protocol.js'`
  2. `docs/api-reference.md` — updated `restale-kit/server` import block to include `createEventStore`, `EventStore`, `EventStoreOptions`, `EventRecord`, `EventStoreResult`
- **Tests:** TypeScript typecheck will validate; no behavioural test needed for a pure type export.
- **Status:** done
- **Follow-ups:** None.
