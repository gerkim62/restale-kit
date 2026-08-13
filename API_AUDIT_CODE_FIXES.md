# Public API Audit — Implementation Fixes

These are implementation defects: a consumer can compile against the advertised public contract, but the runtime does not honor it.

## P0 — Group-level event history is never attached to transport-created channels

`SSEChannelGroup` accepts and stores a shared `eventStore` (or creates one from `eventBufferCapacity`):

- Constructor: `restale-kit/src/server/core/channel-group.ts:281-289`
- Broadcast/publish records signals in that store: `restale-kit/src/server/core/channel-group.ts:925-953`

However, the two transport helpers receive only `Pick<SSEChannelGroup, 'channelDefaults'>`, not `eventStore`, and construct a channel solely from request/setup options:

- Node helper: `restale-kit/src/server/node/attach.ts:26-62`
- Fetch helper: `restale-kit/src/server/fetch/response.ts:15-42`

Replay happens only when the newly created channel itself has an `eventStore` (`restale-kit/src/server/core/channel.ts:398-434`). A new channel created by `group.attachNodeResponse()` or `group.createFetchResponse()` therefore has no access to the group’s recorded history.

**Impact:** The documented group-level pattern—create a shared event store, pass it to `SSEChannelGroup`, then rely on `Last-Event-ID` replay on reconnect—does not work. The group stores broadcasts, emits event IDs, and a reconnect still cannot retrieve those records.

**Fix:** extend the transport helper group dependency to include `eventStore`, then pass `eventStore: options.eventStore ?? group?.eventStore` into `createSSEChannel`. Add end-to-end tests for both Node and Fetch transports: connect, broadcast through a group with a shared store, disconnect, reconnect with `Last-Event-ID`, and assert replay.

## P0 — `ClientOptions` declares four callbacks that the client ignores

**Public declaration:** `restale-kit/src/client/core/client-contracts.ts:143-146`

```ts
callback?: AdaptedInvalidateCallback<...> | ((signal: TSignal | TSignal[]) => void)
onConnect?: (event: Event) => void
onDisconnect?: (event: Event) => void
onError?: (error: unknown) => void
```

**Runtime evidence:** `SSEInvalidatorClient` reads only connection, retry, credential, debug, and target options. A source search finds no reads of `opts.callback`, `opts.onConnect`, `opts.onDisconnect`, or `opts.onError`; its `onopen` handler only changes status and resolves `connect()`, and its error path only dispatches events.

- Constructor/runtime configuration: `restale-kit/src/client/core/sse-client.ts:88-159`
- Open handling: `restale-kit/src/client/core/sse-client.ts:366-386`
- Error handling: `restale-kit/src/client/core/sse-client.ts:388-451`
- The current type tests merely prove that these values are accepted, not that they execute: `restale-kit/src/client/core/sse-client.test-d.ts:150-176`.

**Impact:** Consumers can supply lifecycle and invalidation callbacks with no effect. This is worse than a documentation omission because it silently fails.

**Required decision and fix:** choose exactly one contract.

1. **Support the options:** wire `callback` to validated `invalidate` events, `onConnect` to successful open, `onDisconnect` to stream closure/retry transition, and `onError` to all error paths. Define event ordering and ensure callback exceptions cannot corrupt the client lifecycle.
2. **Remove the options:** delete all four from `ClientOptions`, remove their type tests, and direct users to typed `addEventListener()` listeners. This is the safer choice unless callback options are a deliberate ergonomic feature.

Do not leave them declared without behavior.

## P1 — The client contract duplicates protocol event-detail types

`RevokeEventDetail` and `RenewEventDetail` are independently declared in both protocol and client contracts:

- Protocol definitions: `restale-kit/src/types/protocol.ts:385-420`
- Client definitions: `restale-kit/src/client/core/client-contracts.ts:162-225`

The client imports its local definitions, while the root entry point exports the protocol definitions. The shapes happen to be similar today, but the two declarations are already not textually identical and can drift without a compiler error.

**Impact:** Different subpaths can expose subtly different nominal-looking documentation/contracts for the same SSE event payload.

**Fix:** define each event detail once in `types/protocol.ts`, import it into `client-contracts.ts`, and re-export that same symbol from all relevant public entry points. Add a type test that checks root and client imports are identical.

## P1 — `SSEChannelGroupOptions.pubsub` accepts a configuration object that is silently ignored

**Public declaration:** `restale-kit/src/server/core/channel-group.ts:202`

```ts
pubsub?: PubSubAdapter<TSignal> | { type?: string; encryptionKey?: string }
```

**Runtime evidence:** The constructor keeps a pub/sub value only when it has callable `publish` and `subscribe` methods; any `{ type, encryptionKey }` object becomes `undefined` without an error.

- Assignment: `restale-kit/src/server/core/channel-group.ts:242-245`
- Runtime guard: `restale-kit/src/server/core/channel-group.ts:1007-1013`

**Impact:** `new SSEChannelGroup({ pubsub: { type: 'redis', encryptionKey: '...' } })` type-checks but silently runs as a single-instance group. Cross-instance invalidation and cluster-wide revocation then fail without a configuration error.

**Fix:** Remove the object union and accept only `PubSubAdapter<TSignal>`, or implement a real adapter factory for the object form. If backward compatibility requires accepting it temporarily, throw an explicit configuration error rather than silently disabling pub/sub.

## P1 — `LifetimeOptions.reconnect` is an accepted but unused option

`LifetimeOptions` includes `reconnect?: unknown` in all of its public shapes (`restale-kit/src/types/protocol.ts:314-316`). Channel construction validates this value as a reconnect object (`restale-kit/src/server/core/channel.ts:705-718`) and `mergeChannelDefaults` preserves it (`restale-kit/src/server/core/merge-channel-defaults.ts:104-118`), but no runtime path reads it to alter deadline, renew, or client-retry behavior.

**Impact:** Consumers can configure `lifetime: { ttlMs, reconnect: ... }` and reasonably expect it to matter; it does not.

**Fix:** Either implement an explicit documented meaning for this option, with a concrete type, or remove it from `LifetimeOptions`, validation, and default merging. The current `unknown` type is especially unsuitable for a public configuration field.

## P1 — `autoReconnect.native` does not enable native transport reconnection

The public docs describe `autoReconnect.native` as browser/EventSource native reconnection (`docs/client.md:461-472`). Every `SSE` instance is created with `autoReconnect: false`:

- Ordinary connections: `restale-kit/src/client/core/sse-client.ts:361-367`
- Renew connections: `restale-kit/src/client/core/sse-client.ts:678-683`

The `native` flag only participates in the library’s own `canRetry` expression after a stream has opened (`restale-kit/src/client/core/sse-client.ts:417-426`), which then creates a new `SSE` through the same JavaScript timer path.

**Impact:** The option name and documentation promise a distinction the runtime does not provide. In particular, it does not delegate reconnection to `sse.js`/browser-native retry behavior.

**Fix:** Either implement genuine native reconnect behavior or rename/redefine the option as a managed mid-stream-retry flag and update its docs. Also add a test that distinguishes the intended mechanisms, not only whether a new connection appears.

## P2 — `LifetimeOptions` permits an empty lifetime despite its documented invariant

The public type explicitly includes a third union member where both time values are absent:

```ts
| { ttlMs?: undefined; deadline?: undefined; onDeadline?: OnDeadline; reconnect?: unknown }
```

See `restale-kit/src/types/protocol.ts:314-317`. Runtime validation also accepts `{}` because it only rejects the case where *both* values are present (`restale-kit/src/server/core/channel.ts:693-704`). Yet the type’s own documentation says exactly one of `ttlMs` and `deadline` must be supplied.

**Impact:** `lifetime: {}` type-checks and is accepted, but schedules no deadline. Consumers cannot tell whether it means “no lifetime” or a configuration mistake.

**Fix:** For direct channel options, require exactly one time value. If the empty shape is needed only to support partial `channelDefaults` merging, introduce a separate internal/defaults type instead of weakening the public `LifetimeOptions` contract.

## P2 — Test an option’s behavior rather than only its assignability

The dead options above show a broader gap: public option tests primarily verify assignment. Add runtime tests for every callback-style public option after the P0 decision, covering success, failure, listener/callback ordering, and callback exceptions.

This is a test-strengthening task, not evidence that every other option is currently broken.
