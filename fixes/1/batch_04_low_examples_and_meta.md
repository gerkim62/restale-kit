# Fix Batch 04: Low Severity Examples & Metadata Findings

### [DISC-06-01] Redundant manual connection cleanup in Vercel Redis example conflicting with server guide
- **Audit source:** `audit/1/shard_06_examples-and-scripts.md`
- **Triage decision:** fix-now
- **Reasoning:** `group.register()` automatically handles channel disconnect cleanup. Remove redundant `req.once('close', ...)` listener from `examples/vercel-redis/api/_lib.js`.
- **Change made:** Removed `req.once('close', ...)` from `examples/vercel-redis/api/_lib.js`.
- **Tests:** None.
- **Status:** done
- **Follow-ups:** None.

### [DISC-06-02] Fastify example using manual optional chaining on `meta` in predicate instead of typed metadata
- **Audit source:** `audit/1/shard_06_examples-and-scripts.md`
- **Triage decision:** fix-now
- **Reasoning:** `meta` is typed as non-optional `{ userId: string }`. Update predicate in `examples/backend/fastify/src/index.ts` to `(meta) => meta.userId === userId`.
- **Change made:** Updated Fastify example predicate to `(meta) => meta.userId === userId`.
- **Tests:** None.
- **Status:** done
- **Follow-ups:** None.

### [DISC-07-02] CHANGELOG.md missing v0.2.0 entries for target-discriminated signals and scalar key matching
- **Audit source:** `audit/1/shard_07_package-manifest-and-meta-specs.md`
- **Triage decision:** fix-now
- **Reasoning:** Update `restale-kit/CHANGELOG.md` under `[0.2.0]` with missing feature notes for `ReStaleSignal`, scalar key matching, and `SIGNAL_TARGETS` export.
- **Change made:** Added entries for `ReStaleSignal`, scalar key matching, and `SIGNAL_TARGETS` export under `[0.2.0]` in `restale-kit/CHANGELOG.md`.
- **Tests:** `scripts/extract-changelog.mjs`
- **Status:** done
- **Follow-ups:** None.

### [DISC-07-03] `spec/folder-structure.md` missing `src/utils/` and `src/test-fixtures/` directories
- **Audit source:** `audit/1/shard_07_package-manifest-and-meta-specs.md`
- **Triage decision:** fix-now
- **Reasoning:** Add `src/utils/` and `src/test-fixtures/` to the repo layout tree in `spec/folder-structure.md`.
- **Change made:** Updated tree diagram in `spec/folder-structure.md` to include `src/utils/` and `src/test-fixtures/`.
- **Tests:** None.
- **Status:** done
- **Follow-ups:** None.

