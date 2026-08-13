# Public API Audit — Internalization Candidates

These APIs are reachable through public objects but are implementation details by their purpose and usage. They should not be taught as normal consumer APIs.

## P1 — `SSEInvalidatorClient.closeWithUnmount()`

**Why internal:** The method exists solely to let the React wrapper distinguish an unmount from a user’s explicit `close()`. The implementation comment says it is “Called by the React hook on component unmount,” and the only production caller is `useReStale`.

- Method: `restale-kit/src/client/core/sse-client.ts:258-279`
- Sole production call: `restale-kit/src/client/react/useReStale.ts:321-326`
- It is nevertheless visible on the public client class and is listed in `docs/api-reference.md:264`; the client guide only comments it out at `docs/client.md:295`.

**Risk of public use:** A vanilla consumer can create an artificial React-specific `unmount` status. That status is semantic bookkeeping for the wrapper, not an action in the vanilla client contract.

**Recommended change:** mark the method `/** @internal */`, enable TypeScript declaration stripping (`stripInternal: true`), and remove it from user documentation. The React source can continue calling it during the package build, while the emitted client declaration omits it. Add a declaration/API test that consumer imports cannot name it.

## P1 — `SSEInvalidatorClient.updateRuntimeOptions()`

**Why internal:** Its only production caller is `useReStale`, which uses it to apply changed React props. It exposes a partial option update mechanism with lifecycle implications but no consumer contract or direct-client guide.

- Method: `restale-kit/src/client/core/sse-client.ts:132-159`
- React-only production use: `restale-kit/src/client/react/useReStale.ts:189-197`

**Recommended change:** treat it the same as `closeWithUnmount`: `@internal` plus declaration stripping. If dynamic reconfiguration is intentionally supported for vanilla clients, rename and document it as a stable public API instead; do not leave the current half-public state.

## P1 — Transport-only channel inputs: `connectionId` and `requestedTarget`

**Why internal:** `SSEChannelOptions.connectionId` and `.requestedTarget` are request-derived values populated by the transport adapters. Their comments explicitly say production transport code supplies them and that manual provision is for tests/direct low-level use.

- Option documentation: `restale-kit/src/server/core/channel.ts:47-75`
- Node adapter extracts and supplies them: `restale-kit/src/server/node/attach.ts:50-62`
- Fetch adapter extracts and supplies them: `restale-kit/src/server/fetch/response.ts:30-42`

**Recommended change:** split the type into public direct-channel options and an internal transport options extension. The public `createSSEChannel` input should not invite consumers to manufacture protocol identity or negotiated target state. Retain a deliberately named advanced/internal transport type for in-package adapters and tests.

## P2 — `SSEChannel.disconnect()`

**Why internal:** The public interface documents it as an action “called by a transport adapter when it detects the remote peer disconnected.” The only purpose differs from `close()` by who calls it, not by a consumer-visible operation.

- Interface comment: `restale-kit/src/server/core/channel.ts:147-152`
- Transport callers: Node and Fetch stream/cancellation handling through the internal adapters.

**Recommended change:** mark it `@internal` and strip it from the public `SSEChannel` declaration. Consumers should use `close()`; transport adapters should retain access in source.

## P2 — `lastEventId` is advanced transport state, not an ordinary channel option

`SSEChannelOptions.lastEventId` is legitimate for a custom transport, but ordinary `SSEChannelGroup` users must not set it: the adapters read `Last-Event-ID` themselves.

- Declaration: `restale-kit/src/server/core/channel.ts:39-40`
- Extraction helpers: `restale-kit/src/server/transport-utils.ts:30-70`

**Recommended change:** keep it available only on a clearly labeled low-level/direct-channel options type, and omit it from normal group setup documentation. This is an advanced-public candidate, not a required export removal.

## Implementation note

`@internal` only affects consumers if declaration generation strips internal declarations. Set `compilerOptions.stripInternal: true` for the published declaration build and add API-surface tests against `dist`, not only source imports. Runtime properties remain observable in JavaScript; the supported contract should be enforced by declarations, docs, and semver policy.
