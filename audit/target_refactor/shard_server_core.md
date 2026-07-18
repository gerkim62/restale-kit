# Shard: Server Core (`SSEChannelGroup` & `SSEChannel`)

## Finding SC-01: Dead `target` Property and Artificial Requirement on `SSEChannelGroupOptions`

### Discrepancy Summary
`SSEChannelGroupOptions` currently mandates `target: SignalTarget | SignalTarget[]` in its TypeScript interface and stores it to `this.target`. However, `SSEChannelGroup` never reads `this.target` anywhere during signal broadcasting (`broadcast`, `broadcastByKey`, `publish`), event logging (`eventStore.add`), or PubSub message publishing. Signal transformation is handled entirely by individual `SSEChannel.invalidate()` calls. Requiring `target` on `SSEChannelGroupOptions` is an artificial parameter burden and dead code.

### Four Sources

#### Spec
- [`spec/sse-query-invalidate-contract.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/spec/sse-query-invalidate-contract.md#L550): Updated to state `target` is required on server channel/group configurations.

#### Docs
- [`docs/server.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/docs/server.md#L30): Documents `target` as a required option on `SSEChannelGroupOptions`.
- [`docs/api-reference.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/docs/api-reference.md#L120): Lists `target: SignalTarget | SignalTarget[]` as required on `SSEChannelGroupOptions`.

#### Implementation
- [`restale-kit/src/server/core/channel-group.ts:L149`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel-group.ts#L149): `target: SignalTarget | SignalTarget[]` is marked required in `SSEChannelGroupOptions`.
- [`restale-kit/src/server/core/channel-group.ts:L182`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel-group.ts#L182): Constructor assigns `this.target = options.target`.
- [`restale-kit/src/server/core/channel-group.ts:L326`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel-group.ts#L326): `deliverToChannel` calls `channel.invalidate(signal, eventId)` directly, leaving `this.target` completely unread.
- [`restale-kit/src/server/core/channel-group.ts:L587`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel-group.ts#L587) & [`L686`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel-group.ts#L686): `eventStore.add` and `pubsub.publish` both receive raw signals.

#### Tests
- [`restale-kit/src/server/core/channel-group.test.ts`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel-group.test.ts#L25): Passes `{ target: 'swr' }` to every `new SSEChannelGroup()` invocation to satisfy the TypeScript interface.

### Source of Truth Verdict
**Settled Architectural Decision**: `target` belongs strictly to `SSEChannel` (and transport helpers `attachSSE` / `toSSEResponse`) where the HTTP response stream and `X-ReStale-Target` header live. `SSEChannelGroup` is a target-agnostic pubsub router and MUST NOT require or store `target`. Docs and tests are out of date and must be updated to match the settled source of truth.

### Recommended Fix
1. Remove `target` from `SSEChannelGroupOptions` and `SSEChannelGroup` class properties in `restale-kit/src/server/core/channel-group.ts`.
2. Make `options` optional again in `new SSEChannelGroup(options?: SSEChannelGroupOptions)`.
3. Update `channel-group.test.ts` to remove artificial `{ target: 'swr' }` parameters from `new SSEChannelGroup()`.
4. Update `README.md`, `docs/server.md`, `docs/api-reference.md`, and `spec/sse-query-invalidate-contract.md`.

### Severity & Confidence
- **Severity**: High
- **Confidence**: High

---

## Finding SC-02: Target Transformation Responsibilities in `SSEChannel`

### Discrepancy Summary
`SSEChannel` correctly requires `target: SignalTarget | SignalTarget[]` on `SSEChannelOptions`, exposes `readonly target`, and applies `processTargetSignals(signal, target)` inside `channel.invalidate()`. This is 100% aligned with the settled source of truth.

### Four Sources

#### Spec
- [`spec/sse-query-invalidate-contract.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/spec/sse-query-invalidate-contract.md#L550): Requires server channels to declare supported target(s).

#### Docs
- [`docs/server.md`](file:///home/gerison/coding/experiments/sse-query-invalidator/docs/server.md): Documents `target` as a required option on `createSSEChannel`.

#### Implementation
- [`restale-kit/src/server/core/channel.ts:L13`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel.ts#L13): `target: SignalTarget | SignalTarget[]` is required on `SSEChannelOptions`.
- [`restale-kit/src/server/core/channel.ts:L215`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel.ts#L215): `channel.invalidate()` calls `processTargetSignals(signal, target)`.

#### Tests
- [`restale-kit/src/server/core/channel.test.ts`](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/src/server/core/channel.test.ts): Verifies `createSSEChannel({ target: ... })` framing and `processTargetSignals`.

### Source of Truth Verdict
**Correct & Authoritative**: `SSEChannel` is the single source of truth for target signal transformation and must remain required on `SSEChannelOptions`.

### Recommended Fix
No implementation changes needed for `channel.ts`. Ensure documentation examples reflect `createSSEChannel({ target: ... })` accurately.

### Severity & Confidence
- **Severity**: Info
- **Confidence**: High
