# Shard: Server Transport Adapters (`attachSSE` & `toSSEResponse`)

## Finding SA-01: Transport Adapters Require `target` on Every Channel Creation

### Discrepancy Summary
`attachSSE` (Node, Express, Fastify) and `toSSEResponse` (Fetch, Hono, Next.js) take `options: SSEChannelOptions<TSignal>`. Since `SSEChannelOptions` requires `target`, callers of `attachSSE` and `toSSEResponse` must explicitly supply `{ target: ... }`. The adapters extract `target`, pass it to `createSSEChannel`, and emit the `X-ReStale-Target` HTTP response header.

### Four Sources

#### Spec
- [`spec/sse-query-invalidate-contract.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/spec/sse-query-invalidate-contract.md): Requires server responses to set `X-ReStale-Target` header based on the connection target.

#### Docs
- [`docs/server.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/docs/server.md): Shows `attachSSE` and `toSSEResponse` taking `{ target: ... }`.

#### Implementation
- [`restale-kit/src/server/node/attach.ts:L24`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/node/attach.ts#L24): `options: SSEChannelOptions<TSignal>` is required. Sets `headers['X-ReStale-Target'] = options.target`.
- [`restale-kit/src/server/fetch/response.ts:L20`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/fetch/response.ts#L20): `options: SSEChannelOptions<TSignal>` is required. Sets `headers['X-ReStale-Target'] = options.target`.
- [`restale-kit/src/server/fastify/index.ts:L22`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/fastify/index.ts#L22): Forwards `options` directly to `nodeAttachSSE`.

#### Tests
- [`attach.test.ts`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/node/attach.test.ts), [`response.test.ts`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/fetch/response.test.ts), [`express/index.test.ts`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/express/index.test.ts), [`fastify/index.test.ts`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/fastify/index.test.ts), [`hono/index.test.ts`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/hono/index.test.ts): All pass `{ target: 'swr' }` (or appropriate target) and assert `X-ReStale-Target` header emission.

### Source of Truth Verdict
**Correct & Authoritative**: The transport adapters are the entry point where HTTP response headers are set. Requiring `target` on `attachSSE` and `toSSEResponse` is aligned with the settled source of truth.

### Recommended Fix
No implementation changes needed for transport adapters. Ensure all documentation examples show `attachSSE(req, res, { target: ... })` and `toSSEResponse(request, { target: ... })`.

### Severity & Confidence
- **Severity**: Info
- **Confidence**: High
