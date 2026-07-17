# Audit Ledger Shard: Server Adapters

## Inventory Covered
- `docs/server.md` (Framework adapters section)
- `docs/api-reference.md` (`restale-kit/node`, `/express`, `/fastify`, `/fetch`, `/hono` sections)
- `restale-kit/src/server/node/attach.ts`
- `restale-kit/src/server/fetch/response.ts`
- `restale-kit/src/server/express/index.ts`
- `restale-kit/src/server/fastify/index.ts`
- `restale-kit/src/server/hono/index.ts`
- `restale-kit/src/server/fetch/response.test.ts`
- `restale-kit/src/server/node/attach.test.ts`
- `restale-kit/src/server/express/index.test.ts`
- `restale-kit/src/server/fastify/index.test.ts`
- `restale-kit/src/server/hono/index.test.ts`
- `restale-kit/src/server/e2e-transport.test.ts`

---

### [FINDING-004] Agreement verification: Server framework adapters and E2E transport handling
- **Area:** `docs/server.md`, `docs/api-reference.md`, `restale-kit/src/server/*`
- **Status:** PASS / Agreed
- **Notes:**
  - `restale-kit/node` & `restale-kit/express`: `attachSSE` sets standard SSE headers, extracts `__restale_cid__` and `Last-Event-ID`, pipes stream via `Readable.fromWeb()`, and binds disconnect to `req.on('close')`.
  - `restale-kit/fastify`: Auto-detects `FastifyReplyLike` objects and invokes `reply.hijack()` before piping.
  - `restale-kit/fetch` & `restale-kit/hono`: `toSSEResponse` returns `{ response, channel }`, headers, extracts `__restale_cid__` and `Last-Event-ID`, and binds disconnect to `request.signal.abort`.
  - Missing or invalid `__restale_cid__` parameter throws synchronously as documented across all adapters.
