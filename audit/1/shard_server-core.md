# Audit Ledger Shard: Server Core

## Inventory Covered
- `spec/sse-query-invalidate-contract.md` (Server side section)
- `spec/restale-kit-connection-revocation-spec.md`
- `docs/server.md`
- `docs/api-reference.md` (`restale-kit/server` section)
- `restale-kit/src/server/core/channel.ts`
- `restale-kit/src/server/core/channel-group.ts`
- `restale-kit/src/server/core/event-store.ts`
- `restale-kit/src/server/core/framing.ts`
- `restale-kit/src/server/core/index.ts`
- `restale-kit/src/server/transport-utils.ts`
- `restale-kit/src/server/core/channel.test.ts`
- `restale-kit/src/server/core/channel-group.test.ts`
- `restale-kit/src/server/core/event-store.test.ts`
- `restale-kit/src/server/core/framing.test.ts`
- `restale-kit/src/server/transport-utils.test.ts`

---

### [FINDING-003] Agreement verification: Server core architecture, channel groups, framing, and revocation
- **Area:** `spec/sse-query-invalidate-contract.md`, `spec/restale-kit-connection-revocation-spec.md`, `docs/server.md`, `docs/api-reference.md`, `restale-kit/src/server/core/*`, `restale-kit/src/server/transport-utils.ts`
- **Status:** PASS / Agreed
- **Notes:**
  - `createSSEChannel`: Stream creation, keepalive interval (30s default), event store integration, signal schema validation, framing, auto-reconnection replay via `lastEventId` header, and `revoke()` event frame generation fully match spec and documentation.
  - `SSEChannelGroup`: Channel registration/deregistration, topic-based subscription routing via `TopicManager`, `broadcastToAll`, `broadcast` (with predicate error collection), `broadcastByKey` (key-based hierarchical matching), `publish`, `revokeWhere` (subset metadata matching), `revokeByConnectionId` (scoped connection lookup), and `controlTopic` cluster subscription handling fully match spec and implementation.
  - `EventStore`: Bounded ring buffer, custom/auto event ID generation, and `getEventsAfter` miss detection (triggering `{ key: [] }` full invalidation) are consistent across all sources.
  - `transport-utils`: `extractConnectionId` (`__restale_cid__`) and `extractLastEventId` (with max byte length 512 protection) are fully verified and tested.
