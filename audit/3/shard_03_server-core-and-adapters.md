# Audit 3 Shard 03: Server Core, Framing, Event Store, Adapters

## Reviewed Sources
- `restale-kit/src/server/core/channel.ts`
- `restale-kit/src/server/core/channel.test.ts`
- `restale-kit/src/server/core/channel-group.ts`
- `restale-kit/src/server/core/channel-group.test.ts`
- `restale-kit/src/server/core/event-store.ts`
- `restale-kit/src/server/core/event-store.test.ts`
- `restale-kit/src/server/core/framing.ts`
- `restale-kit/src/server/core/framing.test.ts`
- `restale-kit/src/server/core/index.ts`
- `restale-kit/src/server/transport-utils.ts`
- `restale-kit/src/server/transport-utils.test.ts`
- `restale-kit/src/server/e2e-transport.test.ts`
- `restale-kit/src/server/node/index.ts`
- `restale-kit/src/server/express/index.ts`
- `restale-kit/src/server/fastify/index.ts`
- `restale-kit/src/server/fetch/index.ts`
- `restale-kit/src/server/hono/index.ts`

---

### [AUDIT3-03-01] Agreement Check: Server Channel Group, Framing, Event Store & Framework Adapters
- **Area:** `restale-kit/src/server/**/*`
- **Type:** agreement
- **Evidence:**
  - `channel.ts`: `createSSEChannel` properly enforces `ChannelClosedError`, schema validation, keepalives, `onClose` callbacks, event history replay on connect, and terminal `revoke` frame emission.
  - `channel-group.ts`: `SSEChannelGroup` supports conditional overload signatures for optional vs required metadata based on `TMeta`, handles topic-based routing via `TopicManager`, automatic channel deregistration on close, `broadcastByKey`, `revokeWhere`, `revokeByConnectionId`, and `controlTopic` customization.
  - `framing.ts`: Formats `invalidate` (splitting multi-line JSON), `keepalive`, and `revoke` frames with sanitized `id:` headers.
  - `transport-utils.ts`: Enforces 512-byte limit on `Last-Event-ID` header and verifies `__restale_cid__` query parameter presence.
  - Framework adapters (`express`, `fastify`, `fetch`, `hono`, `node`): Correctly hijack Fastify responses, wire disconnect hooks (`req.on('close')` / `request.signal.abort`), and set standard SSE headers.
- **Discrepancy:** None. Implementation, tests, and documentation are fully consistent.
- **Which source is correct / should be trusted:** Implementation.
- **Recommended fix:** No action required.
- **Severity:** low
- **Confidence:** high
