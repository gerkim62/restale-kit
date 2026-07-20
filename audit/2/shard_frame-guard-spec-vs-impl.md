# Shard: Frame Guard — Spec §§1–7 vs Implementation

**Files covered:**
- Spec: `spec/restale-kit-frame-guard-spec (7).md`
- Impl: `src/server/core/channel.ts`, `src/server/core/framing.ts`, `src/server/core/merge-channel-defaults.ts`, `src/utils/constants.ts`, `src/types/protocol.ts`

---

## AGREEMENTS (spec checks out)

- §4.1: `ttlMs` and `deadline` are mutually exclusive — enforced by `LifetimeOptions` discriminant union in `protocol.ts`. ✓
- §4.1.1: `onDeadline` defaults to `'reconnect'` — `fireDeadline()` in `channel.ts` defaults: `const onDeadline = options.lifetime?.onDeadline ?? 'reconnect'`. ✓
- §4.1.2: `renew` frame carries `reason: 'deadline'`, `maxAttempts`, `retryDelayMs` — `formatRenewFrame` and `FRAME_GUARD_DEFAULTS` match. ✓
- §4.1.4: Server-side jitter applied when scheduling lifetime timer — `FRAME_GUARD_DEFAULTS.DEADLINE_JITTER_WINDOW_MS = 500`, applied in `scheduleLifetimeTimer`. ✓
- §4.1.6: Minimum fire floor enforced — `FRAME_GUARD_DEFAULTS.DEADLINE_MIN_FIRE_DELAY_MS = 250`, applied via `Math.max(DEADLINE_MIN_FIRE_DELAY_MS, rawDelayMs + jitter)`. ✓
- §4.2: `beforeFrame` returns `FrameGuardResult` (`send | skip | close`) — types match. ✓
- §4.2.1: `ctx.signal` is the only structurally-unobtainable field; `connectionId`, `requestedTarget`, `isResume` are convenience fields — all present in `FrameGuardCtx`. ✓
- §4.2.1: `meta` and `connectedAt`/`now` are deliberately excluded — confirmed absent from `FrameGuardCtx`. ✓
- §4.3: `guardKeepalive` is a no-op when `beforeFrame` is absent — `runGuard` only fires when `beforeFrame !== undefined`. ✓
- §5: Configuration matrix — all five combos work by construction; no special-casing needed. ✓
- §6: `close` result treated as `revoke()` path, not deadline path — `invalidateFiltered` calls `channelObj.revoke(result.reason)`. ✓
- §6: Thrown error inside `beforeFrame` treated as `{ action: 'close' }` — `runGuard` catch block logs and returns close. ✓
- §7: Frame Guard `close` converges on same underlying close mechanism as `revokeWhere` — both call `channel.revoke()`. ✓
- §1: `beforeFrame` absent from `ChannelDefaults` — `merge-channel-defaults.ts` `ChannelDefaults` interface has only `lifetime?` and `guardKeepalive?`. ✓
- §1: Group-level `channelDefaults` exposed — `SSEChannelGroupOptions.channelDefaults` and `group.channelDefaults` property present. ✓

---

## DISCREPANCIES

### [FG-01] `mergeChannelDefaults` is not called by the transport adapters — group defaults never reach channels

- **Area:** `src/server/core/merge-channel-defaults.ts`, `src/server/node/attach.ts` (unread), `src/server/fetch/response.ts` (unread), `spec/restale-kit-frame-guard-spec (7).md` §1
- **Type:** spec-not-implemented
- **Evidence:**
  - Spec §1: *"`SSEChannelGroup` may optionally supply `channelDefaults`… so they don't need to be repeated at every `attachSSE()` call site"*
  - `merge-channel-defaults.ts`: `mergeChannelDefaults` is fully implemented and exported from `server/core/index.ts`.
  - `channel-group.ts`: `SSEChannelGroup` stores `this.channelDefaults` but **never calls** `mergeChannelDefaults` — it has no `register()` path that merges defaults into channel options before the channel is constructed. The channel is already constructed by the time `register()` is called.
  - `channel-group.test.ts` `'SSEChannelGroup — channelDefaults'` tests only verify that `group.channelDefaults` is stored and readable — they do **not** test that defaults propagate to channel behavior (e.g. that a channel registered without `guardKeepalive` actually runs the guard on keepalive ticks when the group has `channelDefaults: { guardKeepalive: true }`).
- **Discrepancy:** `mergeChannelDefaults` is implemented correctly in isolation, and `SSEChannelGroup` stores `channelDefaults`, but the integration glue is missing. The spec requires that a `channelDefaults` value in the group be applied to channels created without that option. But `channelDefaults` can only flow to a channel if it is applied **at channel construction time** (inside `attachSSE`/`toSSEResponse`), not at `register()` time — the channel is already built. The transport adapters (`attachSSE`/`toSSEResponse`) would need to accept a `group` argument or the group would need to expose its defaults for the caller to use. Neither mechanism exists.
- **Which source is correct:** The spec is authoritative. The implementation is incomplete — the storage mechanism is there but the propagation mechanism is absent.
- **Recommended fix:** One of:
  a. Transport adapters (`attachSSE`/`toSSEResponse`) accept an optional `group` param; they call `mergeChannelDefaults(options, group.channelDefaults)` before passing options to `createSSEChannel`. The caller passes `group` to both `attachSSE` and later `group.register(channel)`.
  b. Expose a helper `group.applyDefaults(channelOptions)` that callers call manually before `attachSSE`. Less ergonomic but simpler.
  c. Document that `channelDefaults` is a convenience type/container and propagation must be done manually by calling `mergeChannelDefaults` — then update examples accordingly.
  Option (a) matches the spec intent ("don't need to be repeated at every call site").
- **Severity:** high
- **Confidence:** high

---

### [FG-02] `resolveLifetimeMs` computes `rawDelayMs` incorrectly for `ttlMs`

- **Area:** `src/server/core/channel.ts` — `resolveLifetimeMs`
- **Type:** implementation-drift
- **Evidence:**
  ```ts
  // channel.ts lines ~135–140
  function resolveLifetimeMs(connectedAt: number): number | undefined {
    if (options.lifetime === undefined) return undefined
    const { ttlMs, deadline } = options.lifetime
    if (ttlMs !== undefined) return connectedAt + ttlMs - connectedAt  // = ttlMs
    if (deadline !== undefined) return deadline - connectedAt
    return undefined
  }
  ```
  The comment `// = ttlMs` acknowledges the simplification — `connectedAt + ttlMs - connectedAt` is algebraically identical to `ttlMs`. This is harmless but needlessly obscures intent.
- **Discrepancy:** There is no functional bug (the result is correct), but the expression is misleading — it looks like it's computing a delay from `connectedAt` but actually just returns `ttlMs` directly.
- **Which source is correct:** Implementation is functionally correct; this is a code-quality issue not a spec violation.
- **Recommended fix:** Simplify to `if (ttlMs !== undefined) return ttlMs`. Remove the misleading `connectedAt` subtraction.
- **Severity:** low
- **Confidence:** high

---

### [FG-03] `SSEChannelOptions` in `spec/sse-query-invalidate-contract.md` is missing Frame Guard fields

- **Area:** `spec/sse-query-invalidate-contract.md` — Server side → `SSEChannelOptions` interface definition
- **Type:** outdated-doc
- **Evidence:**
  - Contract spec shows `SSEChannelOptions` ending at `idGenerator?: () => string` — no `lifetime`, `beforeFrame`, `guardKeepalive`, or `requestedTarget` fields.
  - Implementation `channel.ts` has all four Frame Guard fields in `SSEChannelOptions`.
  - Frame Guard spec §1 explicitly places these options on `SSEChannelOptions`.
- **Discrepancy:** The main contract spec (`sse-query-invalidate-contract.md`) is the primary reference document for contributors. It doesn't reflect the Frame Guard fields added to `SSEChannelOptions`.
- **Which source is correct:** Implementation is correct (matches frame guard spec). Main contract spec is stale.
- **Recommended fix:** Update `SSEChannelOptions` in `sse-query-invalidate-contract.md` to include `lifetime?`, `beforeFrame?`, `guardKeepalive?`, and `requestedTarget?` with their types and descriptions.
- **Severity:** medium
- **Confidence:** high

---

### [FG-04] `SSEChannelGroup` constructor options in `spec/sse-query-invalidate-contract.md` missing `channelDefaults`

- **Area:** `spec/sse-query-invalidate-contract.md` — `SSEChannelGroup` constructor
- **Type:** outdated-doc
- **Evidence:**
  - Contract spec's `SSEChannelGroup` constructor options: `metaSchema`, `pubsub`, `eventStore`, `eventBufferCapacity`, `controlTopic` — no `channelDefaults`.
  - Implementation `channel-group.ts`: `SSEChannelGroupOptions` includes `channelDefaults?: ChannelDefaults`.
- **Discrepancy:** `channelDefaults` is not documented in the main contract spec, only in the Frame Guard spec.
- **Recommended fix:** Add `channelDefaults?: ChannelDefaults` to the `SSEChannelGroup` constructor options table in `sse-query-invalidate-contract.md`.
- **Severity:** medium
- **Confidence:** high

---

### [FG-05] Spec §4.1.4 jitter is described as happening "when the server sends" renew — but implementation jitters the *timer*, not the send moment

- **Area:** `spec/restale-kit-frame-guard-spec (7).md` §4.1.4 vs `src/server/core/channel.ts` `scheduleLifetimeTimer`
- **Type:** implementation-drift (minor/acceptable)
- **Evidence:**
  - Spec §4.1.4: *"jitter when the server sends `renew` for a given connection (e.g. within a small random window before or after the nominal deadline)"*
  - Implementation: `const jitter = Math.random() * FRAME_GUARD_DEFAULTS.DEADLINE_JITTER_WINDOW_MS` is added to `rawDelayMs`, so the timer fires randomly within `[rawDelayMs, rawDelayMs + 500ms)` — i.e., only *after* the nominal deadline, not "before or after".
- **Discrepancy:** Spec says "before or after"; implementation applies jitter only *after* (only positive offset). A negative jitter would fire the renew slightly before the nominal deadline, which the spec permits and which would give better uniform distribution.
- **Which source is correct:** Both are reasonable — positive-only jitter is simpler and still achieves load spreading. This is an intentional simplification that's slightly inconsistent with the spec's exact wording but not a correctness problem.
- **Recommended fix:** Either update the spec to say "at or after the nominal deadline" or change the jitter to `(Math.random() * 2 - 1) * WINDOW / 2` for true ±window. Low priority.
- **Severity:** low
- **Confidence:** high

---

### [FG-06] `beforeFrame` schema validation ordering: spec §4.2 implies guard runs before frame, but implementation runs schema first

- **Area:** `src/server/core/channel.ts` — `invalidateFiltered`, `spec/restale-kit-frame-guard-spec (7).md` §4.2
- **Type:** undocumented-behavior
- **Evidence:**
  - `invalidateFiltered`:
    1. Schema validation (`validateStandardSchema`) runs first.
    2. `runGuard` (beforeFrame) runs second.
  - Spec §4.2 says the function is "evaluated before a frame is sent" but doesn't specify ordering relative to schema validation.
  - `channel.test.ts` has a test: `'schema validation runs before beforeFrame'` — this is an explicit test *asserting* this ordering.
- **Discrepancy:** The ordering (schema → guard) is not specified in the Frame Guard spec and is not documented in `docs/server.md`. Integrators might reasonably expect that `beforeFrame` runs first (e.g. to skip a session check if the signal is invalid and would be thrown anyway). The current order means `beforeFrame` is never called for signals that fail schema validation — which could hide guard-side close/skip logic.
- **Which source is correct:** The current implementation choice (schema first) is defensible — no point guarding a signal that would be rejected. But it should be documented.
- **Recommended fix:** Add a note to `docs/server.md` Frame Guard section (when it exists) and to the spec: "Schema validation (when configured) runs before `beforeFrame`. If the signal fails validation, `beforeFrame` is never called."
- **Severity:** low
- **Confidence:** high

---

### [FG-07] `channel.ts` — `invalidateFiltered` throws `ChannelClosedError` after calling `revoke()` for `close` result — spec is silent on this

- **Area:** `src/server/core/channel.ts` — `invalidateFiltered`, `spec/restale-kit-frame-guard-spec (7).md` §6
- **Type:** undocumented-behavior
- **Evidence:**
  ```ts
  // invalidateFiltered
  if (result.action === 'close') {
    channelObj.revoke(result.reason)
    throw new ChannelClosedError()
  }
  ```
  - Spec §6: *"A Close result from beforeFrame is functionally equivalent to the integrator calling revocation directly"* — implies closing, but doesn't specify whether `invalidate()` throws.
  - Spec contract section for `invalidate()`: `invalidate()` throws `ChannelClosedError` when channel is closed. The revoke happens, then the channel is closed, then `ChannelClosedError` is thrown.
  - `channel.test.ts`: `'close result — revoke frame sent, channel closes, invalidate throws ChannelClosedError'` — tests this behavior explicitly.
- **Discrepancy:** Throwing `ChannelClosedError` from `invalidate()` when `beforeFrame` returns `close` is behavior callers must know about. The spec does not document that `invalidate()` throws in the guard-close case (only in the "channel already closed" case). A caller checking `try/catch` around `channel.invalidate()` for schema errors would also need to handle this case.
- **Which source is correct:** Implementation behavior is reasonable. Spec should document it.
- **Recommended fix:** Add to the `invalidate()` contract in `sse-query-invalidate-contract.md` and Frame Guard spec §6: "When `beforeFrame` returns `{ action: 'close' }`, `invalidate()` revokes the channel and then throws `ChannelClosedError`."
- **Severity:** low
- **Confidence:** high

---

### [FG-08] `mergeChannelDefaults` is exported from `server/core/index.ts` but NOT listed in the public exports table in `spec/sse-query-invalidate-contract.md`

- **Area:** `src/server/core/index.ts`, `spec/sse-query-invalidate-contract.md` — "Exported type surface"
- **Type:** undocumented-behavior
- **Evidence:**
  - `index.ts`: `export { mergeChannelDefaults } from './merge-channel-defaults.js'` and `export type { ChannelDefaults }`.
  - Contract spec exports table for `restale-kit/server`: `createSSEChannel`, `SSEChannel`, `SSEChannelOptions`, `SSEChannelGroup`, `createEventStore`, `EventStoreOptions` — no `mergeChannelDefaults` or `ChannelDefaults`.
- **Discrepancy:** Public API surface includes `mergeChannelDefaults` and `ChannelDefaults` but neither is documented in the exports table.
- **Recommended fix:** Add both to the `restale-kit/server` row of the exports table.
- **Severity:** low
- **Confidence:** high

---

### [FG-09] `SSEChannel` interface in spec is missing `requestedTarget` property

- **Area:** `spec/sse-query-invalidate-contract.md` — `SSEChannel` interface, `spec/client-target-negotiation.md` — `SSEChannel interface` section
- **Type:** outdated-doc
- **Evidence:**
  - Contract spec `SSEChannel`: `state`, `stream`, `connectionId`, `invalidate()`, `close()`, `disconnect()`, `revoke()`, `onClose()` — no `requestedTarget`.
  - `client-target-negotiation.md` does specify: *"`SSEChannel` interface — add readonly property: `readonly requestedTarget: SignalTarget | undefined`"* — as a "changes required" bullet, but the main contract spec was never updated.
  - Implementation `channel.ts`: `SSEChannel` interface includes `readonly requestedTarget: string | undefined`.
  - Note: implementation widens the type to `string | undefined` (not just `SignalTarget | undefined`) to allow unrecognized client-sent targets to flow through to the unsupported-target rejection path. This is undocumented.
- **Discrepancy:** `requestedTarget` is in the implementation but not in the main contract spec's `SSEChannel` interface definition.
- **Recommended fix:** Add `readonly requestedTarget: string | undefined` (not `SignalTarget`) to `SSEChannel` in `sse-query-invalidate-contract.md`, with a note explaining the `string` widening.
- **Severity:** low
- **Confidence:** high
