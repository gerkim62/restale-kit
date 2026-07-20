# Shard: Frame Guard — Test Coverage Audit

**Files covered:**
- `restale-kit/src/server/core/channel.test.ts` — `Frame Guard — beforeFrame`, `Frame Guard — guardKeepalive`, `Frame Guard — lifetime` describe blocks
- `restale-kit/src/client/core/sse-client.test.ts` — all `frameguard-spec §...` describe blocks
- `restale-kit/src/server/core/merge-channel-defaults.test.ts`
- `restale-kit/src/server/core/channel-group.test.ts` — `channelDefaults` describe block

---

## AGREEMENTS (coverage present and correct)

### Server-side Frame Guard
- `beforeFrame` send/skip/close results — all three tested. ✓
- `ctx` fields: `signal`, `frameType`, `connectionId`, `requestedTarget`, `isResume` — all tested. ✓
- `beforeFrame` error treated as `close` — tested with warn spy. ✓
- Schema validation runs before `beforeFrame` — tested. ✓
- `guardKeepalive: false` — beforeFrame not called on keepalive ticks — tested. ✓
- `guardKeepalive: true` — beforeFrame called, ctx.signal undefined, frameType=keepalive — tested. ✓
- `guardKeepalive: true` with skip/close results — tested. ✓
- `guardKeepalive: true` without beforeFrame — no-op — tested. ✓
- `ttlMs` fires renew frame and closes — tested. ✓
- `deadline` absolute fires renew — tested. ✓
- `onDeadline: 'revoke'` fires revoke frame instead — tested. ✓
- `onDeadline` object form with custom `maxAttempts`/`retryDelayMs` — tested. ✓
- Lifetime timer cleared when channel closes before deadline — tested. ✓
- Already-past deadline fires after minimum floor, not immediately — tested. ✓
- No lifetime — channel never closes on its own — tested. ✓
- Lifetime timer fires onClose callbacks — tested. ✓

### `mergeChannelDefaults`
- Full suite: presence-based merging, guardKeepalive false overrides true, lifetime parts merged independently, onDeadline independence — all tested. ✓
- Immutability (no mutation of original options) — tested. ✓

### Client-side renew
- Renew → connecting → open on success — tested. ✓
- Does NOT consume maxRetries budget (renew budget separate) — tested. ✓
- Renew exhaustion emits revoke with `{ reason: 'deadline' }` — tested. ✓
- `maxAttempts: 2` — second attempt after retryDelayMs — tested. ✓
- Successful renew clears `renewing` flag so subsequent drops use normal backoff — tested. ✓
- Malformed renew (not-json) → hard revoke, no confirmatory attempt — tested. ✓
- `renew` event NOT emitted when payload malformed — tested. ✓
- `onerror` during renew does not start general backoff — tested. ✓
- Renew on reconnected connection (chained cycles) — tested. ✓
- `close()` during renew cancels confirmatory attempt → closed/manual — tested. ✓
- `close()` during delayed renew cancels timer — tested. ✓
- Status stays `connecting` throughout renew sequence — tested. ✓
- Revoke from renew exhaustion does NOT contain `requested`/`supported` — tested. ✓
- Confirmatory ES uses same URL as original — tested. ✓
- Renew event fires BEFORE new ES is created — tested. ✓
- Status is `connecting` at moment renew event fires — tested. ✓
- `retryDelayMs` ignored when `maxAttempts=1` — tested. ✓
- `maxAttempts=1` failure → immediate revoke path (no timer) — tested. ✓
- Jitter lower bound (second attempt not before floor) — tested. ✓
- Jitter upper bound (second attempt within ceiling) — tested. ✓
- Flat delay not exponential (3 attempts, same window each) — tested. ✓
- Renew does not decrement maxRetries slot count — tested. ✓

---

## DISCREPANCIES

### [FT-01] Test comment for `maxAttempts: 0` is factually wrong about implementation behavior

- **Area:** `sse-client.test.ts` — `frameguard-spec §4.1.2` describe block, test `'renew frame with maxAttempts: 0 must not silently floor to 1'`
- **Type:** wrong-test (wrong comment, but test may pass for right reason)
- **Evidence:**
  ```ts
  // Comment in test:
  // The implementation guards `ma >= 1` and substitutes 1. Per spec the client
  // must not override what the server sent — no attempt should be made.
  expect(MockEventSource.instances).toHaveLength(1)
  ```
  The comment says the implementation "substitutes 1" for `maxAttempts: 0`. The actual code:
  ```ts
  if (typeof ma === 'number' && Number.isFinite(ma) && ma >= 1) {
    maxAttempts = Math.floor(ma)
    parseOk = true
  }
  ```
  `ma = 0` fails the `>= 1` guard → `parseOk` stays `false` → hard revoke path (0 confirmatory attempts). The test asserts `toHaveLength(1)` (no new ES) which is correct — but the comment claims the violation is "substitutes 1", which doesn't happen. The test passes for the right reason but the comment describes a wrong failure mode.
- **Discrepancy:** Test behavior is correct; description of the violation is wrong. Could cause a future developer to misdiagnose the intent.
- **Recommended fix:** Update the comment to: "The implementation rejects `maxAttempts: 0` as a parse failure (parseOk=false), correctly falling to the hard-revoke path with no confirmatory attempt. This test documents that `0` means 'treat as malformed/revoke', not 'floor to 1'."
- **Severity:** low
- **Confidence:** high

---

### [FT-02] Test `'renew frame with missing maxAttempts should NOT silently substitute a client-side default'` comment describes a non-existent violation

- **Area:** `sse-client.test.ts` — `frameguard-spec §4.1.2` describe block, first test
- **Type:** wrong-test (misleading comment)
- **Evidence:**
  ```ts
  // Comment:
  // CURRENT BEHAVIOUR: the implementation falls back to FRAME_GUARD_DEFAULTS.RENEW_MAX_ATTEMPTS (1)
  // on a malformed payload, silently substituting a client-side default that the spec
  // explicitly forbids. The test below sends a payload where maxAttempts is intentionally
  // absent. The correct behaviour is to treat this as a protocol error... The implementation
  // instead makes one quiet attempt.
  ```
  This is incorrect. When `maxAttempts` is absent from the frame, the guard:
  ```ts
  if (typeof ma === 'number' && Number.isFinite(ma) && ma >= 1) { ... }
  ```
  `ma` is `undefined` → fails → `parseOk = false` → hard revoke path, 0 attempts. `FRAME_GUARD_DEFAULTS.RENEW_MAX_ATTEMPTS` is **never used as a fallback** in the client. It's a server-side constant for constructing the renew frame.
  The test then asserts `expect(MockEventSource.instances).toHaveLength(1)` — which passes because the implementation correctly goes to hard-revoke. The test passes but the comment describes non-existent misbehavior.
- **Discrepancy:** The comment fabricates a bug that doesn't exist and implies the test is currently failing or exposing a known violation. In practice, the test passes, the implementation is correct. The comment is pure misinformation.
- **Which source is correct:** Implementation is correct. Test comment is wrong.
- **Recommended fix:** Rewrite comment: "Spec §4.1.2: the client must not substitute a default for a missing `maxAttempts`. This test verifies that a frame without `maxAttempts` is treated as malformed → hard revoke path, no confirmatory attempt made."
- **Severity:** medium (a developer reading this will waste time hunting a nonexistent bug)
- **Confidence:** high

---

### [FT-03] `SSEChannelGroup — channelDefaults` tests only verify storage, not propagation to channel behavior

- **Area:** `channel-group.test.ts` — `'SSEChannelGroup — channelDefaults'` describe block
- **Type:** missing-test
- **Evidence:**
  Tests cover:
  - `group.channelDefaults` is stored and readable after construction.
  - `channelDefaults` is undefined when not provided.
  - Works with `guardKeepalive` only, or `lifetime` only.
  
  NOT covered:
  - A channel registered without `guardKeepalive` using a group that has `channelDefaults: { guardKeepalive: true }` actually runs `beforeFrame` on keepalive ticks.
  - A channel without `lifetime` using a group that has `channelDefaults: { lifetime: { ttlMs: 5000 } }` actually fires the deadline.
  - These scenarios would currently silently fail (see FG-01 — the propagation mechanism is missing), which is exactly why no behavioral test exists.
- **Discrepancy:** The absence of behavioral tests for `channelDefaults` propagation is a symptom of FG-01 (the propagation is not implemented). Tests only cover the storage aspect because that's all that works. This gap is worth documenting independently so that when FG-01 is fixed, the test suite is known to be incomplete.
- **Recommended fix:** Once FG-01 is fixed, add tests:
  - `group.channelDefaults.guardKeepalive = true` + channel without `guardKeepalive` → keepalive triggers beforeFrame.
  - `group.channelDefaults.lifetime = { ttlMs: 1000 }` + channel without `lifetime` → deadline fires at 1000ms.
  - `group.channelDefaults.lifetime.onDeadline = 'revoke'` + channel with `lifetime: { ttlMs: 500 }` (no onDeadline) → deadline fires with revoke.
- **Severity:** high (consequence of FG-01)
- **Confidence:** high

---

### [FT-04] No test for `guardKeepalive: true` with no `keepaliveIntervalMs` set — should be a silent no-op

- **Area:** `channel.test.ts` — Frame Guard tests
- **Type:** missing-test
- **Evidence:**
  - Spec §4.3: `guardKeepalive` with no `beforeFrame` is a no-op (tested).
  - `guardKeepalive: true` with `beforeFrame` but no `keepaliveIntervalMs` configured: keepalives never fire (interval = 0), so the guard is never invoked on keepalive ticks. This is implicitly safe but not explicitly tested.
  - The existing test for `guardKeepalive: false` with no `beforeFrame` covers: "no-op, keepalive emitted normally" — but only when `keepaliveIntervalMs` IS set.
- **Discrepancy:** Minor gap — the case of `guardKeepalive: true` + `beforeFrame` set + `keepaliveIntervalMs: 0` (default) is not tested. Should confirm the guard spy is never called.
- **Recommended fix:** Add test: `'guardKeepalive: true but keepaliveIntervalMs is 0 (default) — beforeFrame never called for keepalive'`.
- **Severity:** low
- **Confidence:** high

---

### [FT-05] No test for the `onDeadline` object form with only one of `maxAttempts` or `retryDelayMs` set (other uses spec default)

- **Area:** `channel.test.ts` — Frame Guard — lifetime tests
- **Type:** missing-test
- **Evidence:**
  - Spec §4.1.1: `{ maxAttempts?: number; retryDelayMs?: number }` — both fields are optional in the object form. Omitted fields use the shorthand defaults.
  - `fireDeadline()` in `channel.ts`:
    ```ts
    const maxAttempts = typeof onDeadline === 'object'
      ? (onDeadline.maxAttempts ?? FRAME_GUARD_DEFAULTS.RENEW_MAX_ATTEMPTS)
      : FRAME_GUARD_DEFAULTS.RENEW_MAX_ATTEMPTS
    ```
  - Tests cover the full object form `{ maxAttempts: 3, retryDelayMs: 400 }` but not partial forms like `{ maxAttempts: 2 }` (retryDelayMs defaults) or `{ retryDelayMs: 500 }` (maxAttempts defaults).
- **Recommended fix:** Add tests for `onDeadline: { maxAttempts: 2 }` (retryDelayMs falls back to `RENEW_RETRY_DELAY_MS`) and `onDeadline: { retryDelayMs: 500 }` (maxAttempts falls back to `RENEW_MAX_ATTEMPTS`).
- **Severity:** low
- **Confidence:** high

---

### [FT-06] No test verifies that a `beforeFrame` `close` result does NOT go through `onDeadline` logic — always hard revoke regardless of `onDeadline` setting

- **Area:** `channel.test.ts` — Frame Guard tests, `spec/restale-kit-frame-guard-spec (7).md` §6
- **Type:** missing-test
- **Evidence:**
  - Spec §6: *"Unlike a hit deadline, `beforeFrame` returning `Close` is a positive assertion by the integrator's own logic, not a hint — it is always treated as authoritative and always uses the hard revoke path, regardless of `onDeadline`."*
  - Tests verify `close` result sends a revoke frame and closes the channel. No test explicitly creates a channel with both `beforeFrame` returning `close` and `lifetime: { onDeadline: 'reconnect' }`, then verifies the renew path is NOT taken.
- **Discrepancy:** Spec explicitly calls out that `beforeFrame.close` ignores `onDeadline`. The implementation code confirms this (it calls `channelObj.revoke()` directly). But no test makes this explicit.
- **Recommended fix:** Add test: a channel with `lifetime: { ttlMs: 99999, onDeadline: 'reconnect' }` and `beforeFrame: () => ({ action: 'close' })` — when `invalidate()` is called, the stream must contain a `revoke` frame (not a `renew` frame), confirming `beforeFrame.close` uses the hard revoke path regardless of `onDeadline`.
- **Severity:** low
- **Confidence:** high

---

### [FT-07] No test for `ctx.isResume` when `lastEventId` is provided but `eventStore` is absent

- **Area:** `channel.test.ts` — Frame Guard — beforeFrame tests
- **Type:** missing-test
- **Evidence:**
  - `isResume = lastEventId !== undefined` in `channel.ts` — only the presence of `lastEventId` matters, not whether an `eventStore` is configured.
  - Existing test for `ctx.isResume = true`: provides both `lastEventId` and `eventStore`.
  - Missing: `lastEventId` provided, `eventStore` absent → `isResume` should still be `true`.
- **Recommended fix:** Add test: `'ctx.isResume is true when lastEventId is present even without eventStore'`.
- **Severity:** low
- **Confidence:** high

---

### [FT-08] `frameguard-spec §4.1.3` test `'after renew exhaustion the general backoff loop is completely suppressed'` uses a weak assertion window

- **Area:** `sse-client.test.ts`
- **Type:** wrong-test
- **Evidence:**
  ```ts
  // Advance well past all possible backoff slots (5 * 50ms with no jitter = 250ms total)
  await vi.advanceTimersByTimeAsync(2000)
  // Strictly 2 — original + 1 confirmatory. Any more means the general loop fired.
  expect(MockEventSource.instances).toHaveLength(2)
  ```
  The comment says "5 * 50ms = 250ms total" but advances 2000ms — 8x more than needed. This is fine for correctness but the discrepancy between the comment and the actual advance time makes the test harder to reason about.
- **Discrepancy:** Minor — test is correct, comment is inaccurate.
- **Recommended fix:** Update comment to match the actual advance time.
- **Severity:** low
- **Confidence:** high
