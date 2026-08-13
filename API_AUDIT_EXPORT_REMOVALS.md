# Public API Audit — Export-Removal Candidates

These findings concern package barrels, not merely `export` keywords in implementation modules. A symbol may remain exported inside a source module for in-package imports while disappearing from the package’s supported subpath.

## P1 — Remove `mergeChannelDefaults` from `restale-kit/server`

**Current export:** `restale-kit/src/server/core/index.ts:10`

```ts
export { mergeChannelDefaults } from './merge-channel-defaults.js'
```

**Evidence it is internal:** Its only production callers are the two built-in transport adapters:

- Node: `restale-kit/src/server/node/attach.ts:57`
- Fetch: `restale-kit/src/server/fetch/response.ts:37`

It accepts internal `SSEChannelOptions` configuration and group defaults, then enforces the invariant that a target must be present. It is not used by any guide or normal setup flow; the API reference only lists the higher-level `channelDefaults` configuration.

**Recommendation:** remove the barrel export and leave the function available to in-package transport modules. Consumers configure `channelDefaults`; they should not reproduce the transport merge algorithm.

**Compatibility:** This is a breaking public API removal. Release it only in the next breaking version, or retain a deprecated export for one minor release with an `@deprecated` message that points to `SSEChannelGroup` setup methods.

## Deliberately retained exports

The following superficially low-level exports should remain public because they are supported extension points or are required by public signatures:

| Export | Why retain it |
|---|---|
| `createSSEChannel` | Explicitly provided by `restale-kit/testing` and supports direct/custom transports. Its required target contract needs better docs, not removal. |
| `SSEChannel`, `SSEChannelOptions`, `DirectSSEChannelOptions` | Required to type direct channel creation and custom transport work. Internal fields should be split out instead. |
| `ChannelDefaults` | Users supply it in `SSEChannelGroupOptions.channelDefaults`. |
| `EventStore`, `EventRecord`, `EventStoreResult`, `createEventStore` | Custom replay storage is a documented extension point. |
| `FastifyRequestLike`, `FastifyReplyLike` | Required to name the supported Fastify overload of `attachNodeResponse`. |
| `makeAdaptedCallback` | Needed to author an adapter accepted by `useReStale`; document it as an extension helper instead of hiding it. |
| `validateStandardSchema` and `SchemaValidationError` | Useful companion utility/error for the public `metaSchema` extension point. |
| `PubSubDecryptionError` | Can surface through the public pub/sub error channel and is actionable to adapter users. |

## Not a removal finding: source-private helpers

`internal_attachSSE`, `internal_toSSEResponse`, framing functions, transport extractors, backoff calculation, payload validation, and protocol action arrays are exported from implementation modules only. They are not reachable through the package export map or public barrels. No package-level export removal is needed for them.
