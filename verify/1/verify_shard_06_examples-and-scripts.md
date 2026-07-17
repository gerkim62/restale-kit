# Verification Shard 06: Examples & Scripts

## Findings Re-Verification

### [DISC-06-01] Redundant manual connection cleanup in Vercel Redis example conflicting with server guide
- **Audit claim:** `req.once('close')` in `examples/vercel-redis/api/_lib.js` contradicted `docs/server.md:L161` guidelines.
- **Re-checked evidence:**
  - `examples/vercel-redis/api/_lib.js:L34`: Included redundant manual cleanup callback.
  - `docs/server.md:L161`: Stated automatic deregistration occurs natively.
- **Verdict:** confirmed
- **Reasoning:** Example code contained redundant listener that contradicted best practice docs.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-06-02] Fastify example using manual optional chaining on `meta` in predicate instead of typed metadata
- **Audit claim:** Fastify example predicate used `meta?.userId` when `TMeta` was `{ userId: string }`.
- **Re-checked evidence:**
  - `examples/backend/fastify/src/index.ts:L10`: `(meta) => meta?.userId === userId`.
- **Verdict:** confirmed
- **Reasoning:** Inconsistent optional chaining on non-nullable generic metadata type.
- **Correction (if any):** None.
- **Confidence:** high
