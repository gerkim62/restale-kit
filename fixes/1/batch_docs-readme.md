# Batch: docs/README.md (FINDING-009)

**Audit shard:** `shard_general-and-meta.md`

---

### [FINDING-009] `docs/README.md` quick-orientation map says `/node` works for Fastify

- **Audit source:** `shard_general-and-meta.md`
- **Triage decision:** fix-now
- **Reasoning:** The map listed `restale-kit/node → attachSSE (Express, Fastify, raw Node)`. Using the Node adapter with Fastify requires manually unwrapping `.raw` and calling `reply.hijack()` — which is exactly what the `/fastify` subpath handles automatically. A developer following this hint would get a broken Fastify integration without understanding why.
- **Change made:** `docs/README.md` — changed the `/node` entry from `attachSSE  (Express, Fastify, raw Node)` to `attachSSE  (raw Node http.IncomingMessage / ServerResponse)`. Fastify is no longer listed for `/node`.
- **Tests:** None needed — documentation change.
- **Status:** done
- **Follow-ups:** None.
