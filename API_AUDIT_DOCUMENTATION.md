# Public API Audit — Documentation Corrections

This report lists source-verified documentation defects. API-design changes from the companion reports may create additional documentation work when implemented.

## P1 — The wire-protocol description is wrong

`docs/api-reference.md:115` and `docs/server.md:176` say outgoing invalidation frames strip the signal `target`. `formatInvalidateFrame()` instead performs `JSON.stringify(signal)` unchanged (`restale-kit/src/server/core/framing.ts:32-35`), and target round-trip tests require the discriminator.

**Correct statement:** the target remains in each signal frame. `X-ReStale-Target` describes negotiated connection targeting; it does not replace the frame discriminator.

## P0 — The documented group-level event replay setup does not work

The server guide tells consumers to pass a shared `eventStore` to `SSEChannelGroup` and says transport methods connect it to channels for `Last-Event-ID` replay (`docs/server.md:409-433`). The group stores events, but its Node and Fetch transport helpers do not pass the group store to newly created channels. See the matching implementation finding in [implementation fixes](./API_AUDIT_CODE_FIXES.md).

Do not present this setup as working until the transport code propagates the shared store. After the fix, retain the guide and add an end-to-end example/test.

## P1 — Wrong TanStack constant name

`docs/api-reference.md` declares `SIGNAL_TARGETS.TANSTACK`; the actual constant is `SIGNAL_TARGETS.TANSTACK_QUERY` in `restale-kit/src/utils/constants.ts:92-97`.

## P1 — Invented client-context API

`docs/api-reference.md` documents `ClientOptions.clientContext` and `UseReStaleResult.updateClientContext()`. Neither exists in the client source or public declaration. Remove both.

## P1 — Incorrect TanStack signal examples

- `docs/getting-started.md` correctly broadcasts `{ queryKey: ['todos'] }`, then incorrectly describes `{ key: ['todos'] }` below it.
- `docs/validation.md` configures a TanStack-targeted group, then calls `group.broadcast({ key: ['admin-data'] }, ...)`.

`TanStackQuerySignal` requires `queryKey` (`restale-kit/src/types/protocol.ts:27-34`). Correct both examples to use `queryKey`.

## P1 — Validation guide promises unsupported SWR behavior

`docs/validation.md:28` documents an `optimisticData` SWR signal field and claims it updates the SWR cache. `SWRSignal` has no such field (`restale-kit/src/types/protocol.ts:40-46`), and the validator rebuilds recognized fields only (`restale-kit/src/client/core/validation.ts:130-150`). Remove the claim.

## P1 — Pub/sub example cannot satisfy its own scoped revocation call

`docs/pubsub.md` registers only `topics`, then invokes `revokeByConnectionId(connectionId, { userId, sessionId })`. Scoped revocation matches that object against registered metadata, which is `undefined` in the shown route.

**Fix:** add trusted `meta: { userId, sessionId }` at registration, or show unscoped revocation only where authorization is already enforced elsewhere. Source matching: `restale-kit/src/server/core/channel-group.ts:727-758` and `1091-1097`.

## P2 — API reference does not match its “Complete export surface” claim

The server, client, React, testing, and adapter sections omit or misstate material public contracts. Key examples:

- Client: missing rejected status/event and renew/retries-exhausted events; missing runtime option fields; incorrect `AutoReconnectOptions` availability.
- React: missing `onRejected`, `onRetriesExhausted`, `attempt`, `isConnecting`, `isReconnecting`, `isClosed`, and `isError`.
- TanStack adapter: docs invent an options argument; actual adapter takes only `QueryClientLike`.
- RTK Query: package exports `restale-kit/rtk-query`, but it has no guide/reference section.
- Testing: direct channel creation requires a target; the reference shows an overly broad `SSEChannelOptions` signature.

Update the reference from emitted declarations after the boundary decisions are implemented. It should either truly enumerate all public exports or be renamed as a selective reference.

## P2 — Documentation must follow internalization decisions

If the recommended changes are accepted, remove `closeWithUnmount()` from `docs/api-reference.md` and the commented vanilla-client mention in `docs/client.md`. Document only `close()` for normal clients. Likewise, do not document `updateRuntimeOptions()` unless it is intentionally retained as a supported vanilla-client API.

## P1 — The `autoReconnect.native` explanation promises a mechanism the client disables

The granular retry section says `native` controls native browser/EventSource reconnection. The client constructs `sse.js` with `autoReconnect: false` for both standard and renew connections, so all retries are managed by this package. See the matching implementation finding in [implementation fixes](./API_AUDIT_CODE_FIXES.md).

Until native reconnect is implemented, describe the actual two managed policies—or remove the object form from the public contract.

## P2 — Missing import in validation example

`docs/validation.md` uses `InvalidateSignal` in `new SSEChannelGroup<InvalidateSignal, ClientMeta>(...)` without importing it. Add `import type { InvalidateSignal } from 'restale-kit'`.
