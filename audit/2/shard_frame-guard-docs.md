# Shard: Frame Guard — Documentation Coverage

**Files covered:**
- Docs: `docs/server.md`, `docs/client.md`
- Spec: `spec/restale-kit-frame-guard-spec (7).md`, `spec/restale-kit-frame-guard-usage-matrix (1).md`
- (docs/getting-started.md, docs/api-reference.md, docs/pubsub.md, docs/validation.md not yet read)

---

## AGREEMENTS

- `docs/server.md` correctly documents `attachSSE`, `SSEChannelGroup`, `register`, `broadcast*`, revocation APIs, reconnection/eventStore — all consistent with implementation. ✓
- `docs/client.md` correctly documents `useReStale`, `SSEInvalidatorClient`, reconnect strategy, adapter mapping. ✓
- `docs/client.md` `onRevoke` callback and `RevokeEventDetail` discrimination (including `unsupported-target`) documented correctly. ✓
- `docs/client.md` native vs JS reconnect distinction, `autoReconnect` object form documented correctly. ✓

---

## DISCREPANCIES

### [FD-01] `docs/server.md` has NO mention of Frame Guard (`lifetime`, `beforeFrame`, `guardKeepalive`, `channelDefaults`) — the feature is entirely absent from user-facing docs

- **Area:** `docs/server.md`, `spec/restale-kit-frame-guard-spec (7).md`
- **Type:** spec-not-implemented (in docs)
- **Evidence:**
  - `docs/server.md` covers: framework adapters, `SSEChannelGroup`, register/deregister, broadcasting, revocation, reconnection/replay, teardown. The `SSEChannelGroup` constructor options table lists `metaSchema`, `pubsub`, `eventBufferCapacity`, `eventStore`, `controlTopic` — no `channelDefaults`.
  - No mention of `lifetime`, `beforeFrame`, `guardKeepalive`, or `channelDefaults` anywhere in `docs/server.md`.
  - `attachSSE`/`toSSEResponse` options are shown as `{ target: 'swr' }` in all examples — Frame Guard options never appear.
  - Frame Guard spec exists in full detail across two spec documents. Implementation is complete.
- **Discrepancy:** The entire Frame Guard feature — arguably one of the most significant additions to the library — is invisible to anyone reading only the user-facing docs. This is the most impactful documentation gap in the audit.
- **Which source is correct:** Spec and implementation are correct. Docs are incomplete.
- **Recommended fix:** Add a `## Frame Guard` section to `docs/server.md` covering:
  1. The three options: `lifetime` (`ttlMs`/`deadline`/`onDeadline`), `beforeFrame` (with ctx fields), `guardKeepalive`.
  2. Where they go: on `SSEChannelOptions` (passed to `attachSSE`/`toSSEResponse`), not on `register()`.
  3. Group defaults: `channelDefaults` in `SSEChannelGroup` constructor for `lifetime` and `guardKeepalive`.
  4. The `onDeadline: 'reconnect'` (default) vs `'revoke'` behavior including the `renew` frame.
  5. The `beforeFrame` close/skip/send results and what happens on each.
  6. `guardKeepalive` opt-in and cost tradeoff.
  7. Practical examples for each combination in the usage matrix.
  8. Reference to the eventStore recommendation for `onDeadline: 'reconnect'` (from usage-matrix §7).
- **Severity:** critical
- **Confidence:** high

---

### [FD-02] `docs/client.md` has NO mention of the `renew` event, `renew` frame behavior, or deadline-driven reconnect from the client perspective

- **Area:** `docs/client.md`, `spec/restale-kit-frame-guard-spec (7).md` §4.1.2
- **Type:** spec-not-implemented (in docs)
- **Evidence:**
  - `docs/client.md` lists events: `invalidate`, `revoke`, `statuschange`, `error` — `renew` is absent.
  - The `ConnectionStatus` reason table lists `'revoked'` with comment "Server sent a terminal `revoke` frame" but does NOT mention that `{ status: 'closed', reason: 'revoked' }` can also be reached via renew exhaustion (`{ reason: 'deadline' }` on the revoke event).
  - Reconnect section describes native reconnect and JS backoff but says nothing about the separate renew/confirmatory reconnect path.
  - `RevokeEventDetail` table in `docs/client.md` (`onRevoke` examples) only covers `unsupported-target` and generic reasons — `{ reason: 'deadline' }` from renew exhaustion is not mentioned.
- **Discrepancy:** A user whose connections are being deadline-closed will see `{ status: 'closed', reason: 'revoked' }` with `{ reason: 'deadline' }` and have no way to understand what happened from the docs. They also cannot observe the intermediate reconnect attempts.
- **Which source is correct:** Docs are incomplete.
- **Recommended fix:** Add to `docs/client.md`:
  - Under "Server-initiated revocation": a note that `{ reason: 'deadline' }` means the server's lifetime deadline triggered a confirmatory reconnect cycle that exhausted its attempts. Distinguish from `{ reason: 'logout' }` etc.
  - A new subsection "Deadline-driven reconnect (`renew`)" describing: the `renew` event (observational, auto-reconnect happens regardless), `detail.maxAttempts`/`detail.retryDelayMs`, and that exhaustion emits `revoke` with `{ reason: 'deadline' }`.
  - A note in the reconnect strategy section that the renew confirmatory reconnect uses its own isolated attempt budget, not `maxRetries`.
- **Severity:** high
- **Confidence:** high

---

### [FD-03] `docs/server.md` `SSEChannelGroup` constructor options table is incomplete — `channelDefaults` missing

- **Area:** `docs/server.md` — `SSEChannelGroup` section
- **Type:** outdated-doc
- **Evidence:**
  - Constructor options table: `metaSchema`, `pubsub`, `eventBufferCapacity`, `eventStore`, `controlTopic`.
  - Implementation has `channelDefaults?: ChannelDefaults`.
  - Frame Guard spec §1 describes group-level defaults in detail.
- **Discrepancy:** Same as FG-04 but from the docs perspective. Even if Frame Guard docs are added (see FD-01), this table needs a `channelDefaults` row.
- **Recommended fix:** Add row: `channelDefaults | ChannelDefaults | Default values for Frame Guard options (`lifetime`, `guardKeepalive`) applied to channels that don't set them directly.`
- **Severity:** medium (blocked by FD-01 which is more impactful)
- **Confidence:** high

---

### [FD-04] `docs/server.md` eventStore setup section does not mention the usage-matrix §7 recommendation to combine `eventStore` with `onDeadline: 'reconnect'`

- **Area:** `docs/server.md` — "Reconnection & Event History Replay", `spec/restale-kit-frame-guard-usage-matrix (1).md` §7
- **Type:** spec-not-implemented (recommendation not propagated to docs)
- **Evidence:**
  - Usage matrix §7: *"Recommendation to make explicit in the actual Frame Guard docs: any integrator using `onDeadline: 'reconnect'` (the default) should be pointed at the `eventStore` setup in the same breath, since the two features compose to close the 'confirmatory reconnect might miss a signal' gap"*
  - `docs/server.md` eventStore section describes setup correctly but makes no mention of Frame Guard deadlines.
- **Discrepancy:** The usage matrix explicitly flags this as a documentation TODO. It's undelivered.
- **Which source is correct:** Usage matrix is the planning document; docs are the delivery surface. The gap is real.
- **Recommended fix:** Add a cross-reference note in the Frame Guard docs (FD-01) and the eventStore docs: "When using `lifetime` with `onDeadline: 'reconnect'` (the default), configure an `eventStore` to prevent signals sent during the brief close-and-reconnect window from being lost."
- **Severity:** medium
- **Confidence:** high

---

### [FD-05] `docs/client.md` `connect()` behavior table is missing the `closed (revoked)` row documented in the spec/contract

- **Area:** `docs/client.md` — `connect()` behavior table, `spec/sse-query-invalidate-contract.md` — `connect()` edge cases
- **Type:** outdated-doc
- **Evidence:**
  - `docs/client.md` table has rows: `'open'`, `'connecting' (active attempt)`, `'connecting' (backoff)`, `'closed' (manual)`, `'closed' (unmount)`, `'error'` — but NOT `'closed' (revoked)`.
  - `spec/sse-query-invalidate-contract.md` `connect()` edge cases table lists `'closed' (unmount)`: *"Same as manual — allows reuse after re-mount"* and implicitly covers revoked. But `docs/client.md`'s parallel table is missing the revoked row.
  - `client.ts`/`sse-client.ts`: `connect()` from a `closed/revoked` state is legal — it resets `this.revoked = false` and creates a new connection.
- **Discrepancy:** A user who receives a `revoke` event and wants to reconnect after re-authentication needs to know that `connect()` is safe to call. The docs don't show this row.
- **Recommended fix:** Add row: `'closed' (revoked) | Same as manual — resets the revoked flag and opens a fresh connection. Use after re-authentication or manual reconnect.`
- **Severity:** low
- **Confidence:** high

---

### [FD-06] `docs/server.md` `attachSSE`/`toSSEResponse` options shown only as `{ target: 'swr' }` — no mention of other `SSEChannelOptions` fields in examples

- **Area:** `docs/server.md` — framework adapter examples
- **Type:** outdated-doc
- **Evidence:**
  - All adapter examples (`Express`, `Node http`, `Fastify`, `Hono`) show `attachSSE(req, res, { target: 'swr' })` with nothing else.
  - `SSEChannelOptions` has many fields: `keepaliveIntervalMs`, `retryIntervalMs`, `signalSchema`, `lastEventId`, `eventStore`, `eventBufferCapacity`, `idGenerator`, `connectionId`, `requestedTarget`, plus all Frame Guard fields.
  - None of these are shown in examples. Only the eventStore example (under Reconnection section) shows `{ target: 'swr', eventStore }`.
- **Discrepancy:** Not a missing-feature issue — more of a documentation depth concern. Particularly, `keepaliveIntervalMs` (required to use `guardKeepalive`) has no example anywhere in the server docs.
- **Recommended fix:** This is partially addressed by the Frame Guard section (FD-01). Also add a brief mention of `keepaliveIntervalMs` in the Frame Guard examples since `guardKeepalive: true` without it is a no-op.
- **Severity:** low
- **Confidence:** high
