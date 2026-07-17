# Audit Shard 03: Server Core & Web Framework Adapters

### [AUDIT2-03-001] Verified agreement on `SSEChannelGroup` and transport adapters channel management
- **Area:** `restale-kit/src/server/core/channel.ts`, `restale-kit/src/server/core/channel-group.ts`, `restale-kit/src/server/node/attach.ts`, `restale-kit/src/server/fetch/response.ts`, `restale-kit/src/server/fastify/index.ts`
- **Type:** undocumented-behavior
- **Evidence:**
  - `restale-kit/src/server/core/channel.ts:187-205`: Shared `eventStore` duplicate recording guard checks `getEventsAfter(customId)` before calling `eventStore.add()`.
  - `restale-kit/src/server/fastify/index.ts:24-26`: `attachSSE` automatically checks `'hijack' in res` and calls `reply.hijack()`.
  - `restale-kit/src/server/transport-utils.ts:51-57`: Enforces a 512-byte `MAX_LAST_EVENT_ID_LENGTH` on incoming `Last-Event-ID` headers to prevent buffer scan DoS attacks.
- **Discrepancy:** None — behavior is consistent across spec, docs, tests, and implementation.
- **Which source is correct / should be trusted:** Implementation matches specification and documentation.
- **Recommended fix:** No code changes needed.
- **Severity:** low
- **Confidence:** high
