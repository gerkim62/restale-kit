# Shard: Frame Guard — Client-side spec vs sse-client.ts

**Files covered:**
- Spec: `spec/restale-kit-frame-guard-spec (7).md` §§4.1.2, 4.1.3, 4.1.5, 4.1.6
- Impl: `src/client/core/sse-client.ts`, `src/client/core/client-contracts.ts`, `src/utils/constants.ts`

---

## AGREEMENTS (spec checks out)

- §4.1.2 renew distinct from onerror: `renewing = true` flag gates the `onerror` JS-backoff path — `!this.renewing` guard in `onerror`. ✓
- §4.1.3 retry-budget isolation: `this.attempt` is reset to 0 on `wireRenewSuccess` (successful reconnect path), full budget available after a successful renew cycle. ✓
- §4.1.2 `maxAttempts` and `retryDelayMs` read from the frame: implementation reads `ma` and `rd` from the parsed payload. ✓
- §4.1.5 fixed delay not exponential: `retryDelayMs` is a flat interval, not `delay * 2^n`. ✓
- §4.1.5 client-side jitter ±20%: `FRAME_GUARD_DEFAULTS.RENEW_JITTER_FACTOR = 0.2` applied in `onRenewError`. ✓
- §4.1.2 first attempt immediate, no initial delay: `attemptRenewReconnect()` called directly before any timer. ✓
- §4.1.2 same URL for confirmatory attempt: `new EventSource(this.eventSourceUrl)` reuses identical URL (including `__restale_cid__`). ✓
- Malformed renew payload → hard revoke path: `if (!parseOk || maxAttempts === undefined)` → `this.revoked = true`, `revoke` event with `{ reason: 'deadline' }`. ✓
- `renew` CustomEvent fired before first attempt: dispatch happens before `attemptRenewReconnect()` call. ✓
- `close()` during renew: `teardown()` clears `renewRetryTimer`; `onRenewError` guard `if (this.eventSource === null) return` prevents stale callbacks. ✓

---

## DISCREPANCIES

### [FC-01] Client applies a floor of `ma >= 1` to `maxAttempts` from the renew frame — spec explicitly forbids this

- **Area:** `src/client/core/sse-client.ts` renew listener, `spec/restale-kit-frame-guard-spec (7).md` §4.1.2
- **Type:** implementation-drift
- **Evidence:**
  ```ts
  // sse-client.ts — renew listener
  if (typeof ma === 'number' && Number.isFinite(ma) && ma >= 1) {
    maxAttempts = Math.floor(ma)
    parseOk = true
  }
  ```
  Spec §4.1.2: *"The client holds no independent default and performs no local override — `maxAttempts` is read from the frame the server sent for that deadline hit, full stop."*
  A server sending `maxAttempts: 0` is treated by the implementation as a parse failure (`parseOk` stays false → hard revoke path). But the spec is silent on what `0` means — the intent is that the client must not substitute anything. A server sending `0` is a server bug, but the spec says even then the client should not override.
  More importantly: if the frame omits `maxAttempts` entirely (valid for a server that forgot the field), `parseOk = false` and the implementation falls to a hard revoke — this part **is** spec-compliant. However, `maxAttempts: 0` cases are treated identically to missing `maxAttempts`, which the spec permits (since both are unusable).
  The real violation: the `ma >= 1` guard is actually the right behavior for malformed frames, but the guard also prevents a server from intentionally sending `maxAttempts: 0` as a signal meaning "don't reconnect at all" (treat as revoke). The spec would want the client to respect that. Currently the client does the right thing by accident (treats it as parse failure → hard revoke), but for the wrong reason.
- **Discrepancy:** Minor — current behavior is accidentally spec-compliant for `maxAttempts: 0`. The actual spec violation called out by the test `'renew frame with maxAttempts: 0 must not silently floor to 1'` **does not apply** to the current implementation because the `>= 1` guard treats `0` as parseOk=false, not as `floor(0)=0→substitute 1`. The test comment claims the implementation substitutes 1, but this is incorrect — the guard rejects `ma < 1` entirely, falling to the hard-revoke path. The test *passes* for the right reason but its comment is wrong.
- **Which source is correct:** Implementation is actually correct here. The test comment is misleading.
- **Recommended fix:** Correct the test comment in `sse-client.test.ts` in the `frameguard-spec §4.1.2` describe block — the statement "The implementation guards `ma >= 1` and substitutes 1" is incorrect. The implementation rejects `ma < 1` entirely (parseOk=false → hard revoke), which is the spec-correct path.
- **Severity:** low
- **Confidence:** high

---

### [FC-02] Client renew: `renewRetryTimer` is not cleared when `close()` is called while timer is active — close can leak a scheduled attempt

- **Area:** `src/client/core/sse-client.ts` — `teardown()`, `close()`, `onRenewError`
- **Type:** implementation-drift
- **Evidence:**
  ```ts
  // teardown()
  private teardown(): void {
    this.opened = false
    if (this.eventSource) {
      this.eventSource.onopen = null
      this.eventSource.onerror = null
      this.eventSource.close()
      this.eventSource = null
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.renewRetryTimer !== null) {
      clearTimeout(this.renewRetryTimer)
      this.renewRetryTimer = null
    }
  }
  ```
  Actually `teardown()` **does** clear `renewRetryTimer`. But `onRenewError` checks `if (this.eventSource === null) return` — however when `close()` is called: `teardown()` sets `this.eventSource = null` and clears `renewRetryTimer`. Then `close()` sets status to `closed/manual`. Any subsequent `renewRetryTimer` callback would have been cleared. So this is actually working correctly.
- **Discrepancy:** None — implementation is correct. This is a ✓ agreement. Marked for completeness.
- **Confidence:** high

---

### [FC-03] `renew` event is defined in `SSEInvalidatorClientEventMap` but not mentioned in `docs/client.md`

- **Area:** `src/client/core/client-contracts.ts`, `docs/client.md`
- **Type:** undocumented-behavior
- **Evidence:**
  - `client-contracts.ts`: `SSEInvalidatorClientEventMap` includes a `renew` event with a detailed JSDoc describing when it fires.
  - `docs/client.md`: Documents `invalidate`, `revoke`, `statuschange`, `error` events. The `renew` event is not mentioned anywhere in the client docs.
  - `client.md` also has no mention of the `renew` frame concept at all, despite the server guide mentioning `onDeadline: 'reconnect'` as the default lifetime behavior.
- **Discrepancy:** Integrators using `SSEInvalidatorClient` directly (non-React) have no documented way to know that `renew` events exist or what to do with them. The `renew` event is purely observational (reconnect happens automatically), but its absence from docs leaves a gap especially for debugging deadline behavior.
- **Which source is correct:** Implementation and types are correct. Docs are incomplete.
- **Recommended fix:** Add a brief section to `docs/client.md` under `SSEInvalidatorClient` describing:
  - The `renew` event: when it fires, what `detail.maxAttempts` and `detail.retryDelayMs` mean, that listening is optional (reconnect is automatic).
  - That renew exhaustion emits a `revoke` event with `{ reason: 'deadline' }` — distinguishing deadline-driven revocation from auth-driven revocation.
- **Severity:** medium
- **Confidence:** high

---

### [FC-04] Spec §4.1.6 re-uses `retryDelayMs` as the minimum-fire floor across cycles — but `DEADLINE_MIN_FIRE_DELAY_MS` is a server-side constant and the spec attributes this to the client

- **Area:** `spec/restale-kit-frame-guard-spec (7).md` §4.1.6 vs `src/utils/constants.ts`
- **Type:** contradiction (minor, spec self-referential)
- **Evidence:**
  - Spec §4.1.6: *"What this scenario does require is a floor on how soon a freshly-connected channel's deadline is allowed to fire: never immediately. The earliest a channel's deadline may trigger onDeadline handling is `retryDelayMs` after that channel's connection began… This reuses `retryDelayMs` rather than introducing a separate field for it"*
  - Constants: `FRAME_GUARD_DEFAULTS.DEADLINE_MIN_FIRE_DELAY_MS = 250` (equals `RENEW_RETRY_DELAY_MS = 250`).
  - `channel.ts`: `scheduleLifetimeTimer` uses `DEADLINE_MIN_FIRE_DELAY_MS` (250ms) as the floor, not `retryDelayMs` from the channel's `onDeadline` config.
  - Spec says the floor is "retryDelayMs" — implying it should use the *configured* `retryDelayMs` (which may differ if the integrator set `onDeadline: { retryDelayMs: 1000 }`). The implementation hardcodes 250ms regardless of what the integrator configured.
- **Discrepancy:** If an integrator sets `lifetime: { ttlMs: 5000, onDeadline: { retryDelayMs: 1000 } }` and the channel is created with a stale deadline (already past), the spec says the minimum fire delay should be 1000ms (matching their configured retryDelayMs). The implementation fires after 250ms (the constant). This is a spec violation for non-default `retryDelayMs` values.
- **Which source is correct:** Spec intent is clearer — the floor should respect the configured `retryDelayMs` from `onDeadline`. Implementation uses a hardcoded constant.
- **Recommended fix:** In `scheduleLifetimeTimer`, resolve the configured `retryDelayMs` from `options.lifetime?.onDeadline` (if it's an object form) and use that as the floor instead of the constant. Fall back to `FRAME_GUARD_DEFAULTS.RENEW_RETRY_DELAY_MS` (250) when `onDeadline` is `'reconnect'` or `'revoke'` or unset.
- **Severity:** low (edge case: only triggers when deadline is already past at creation time AND integrator uses custom retryDelayMs)
- **Confidence:** medium (spec language is precise, but the scenario is narrow)

---

### [FC-05] `RevokeEventDetail` type for renew exhaustion case (`{ reason: 'deadline' }`) conflicts with the discriminated union's second branch exclusion

- **Area:** `src/client/core/client-contracts.ts` — `RevokeEventDetail`, `src/client/core/sse-client.ts`
- **Type:** contradiction
- **Evidence:**
  ```ts
  // client-contracts.ts
  export type RevokeEventDetail =
    | {
        reason: 'unsupported-target'
        requested: string
        supported: string[]
      }
    | {
        reason: Exclude<string, 'unsupported-target'> | undefined
        requested?: never
        supported?: never
      }
  ```
  - `Exclude<string, 'unsupported-target'>` is just `string` in TypeScript (because `string` is wider than `'unsupported-target'`). The `Exclude` has no runtime or compile-time effect here — it's a misleading annotation.
  - Renew exhaustion dispatches `{ reason: 'deadline' }` — this matches the second branch and is valid at runtime. But the type intent (to document that `'deadline'` is a possible revoke reason from the renew path) is not visible in the type — `'deadline'` is just one of infinitely many strings.
  - `SSEInvalidatorClientEventMap.renew.detail.reason` is always `'deadline'` — callers can distinguish deadline-driven revokes from auth-driven revokes by checking `reason === 'deadline'`.
- **Discrepancy:** `Exclude<string, 'unsupported-target'>` is a no-op narrowing. TypeScript does not subtract a literal from `string`. The second branch is effectively `{ reason: string | undefined }`. The type does not prevent a consumer from accidentally treating `'deadline'` as a session-revoke reason.
- **Which source is correct:** The intent is sound (document distinct revoke reasons), but the TypeScript type doesn't enforce it.
- **Recommended fix:** Change the second branch's `reason` to an explicit union of known values: `reason: 'deadline' | 'session-expired' | 'logout' | 'banned' | (string & {}) | undefined` (the `string & {}` trick preserves IDE autocomplete for known values while allowing arbitrary strings). Or add `'deadline'` as its own branch: `| { reason: 'deadline' }`. This makes the renew-exhaustion case more discoverable.
- **Severity:** low
- **Confidence:** high

---

### [FC-06] `sse-client.ts` does not export or use `tanstackAdapter` brand to auto-infer `target` — `docs/client.md` claims this happens

- **Area:** `docs/client.md` — *"Target auto-inference"* note, `src/client/core/sse-client.ts`
- **Type:** outdated-doc (or spec-not-implemented, depending on where this lives)
- **Evidence:**
  - `docs/client.md`: *"When you pass `onInvalidate` from `useTanstackQueryAdapter` or `useSwrAdapter`, the `target` is inferred automatically"*
  - `client-contracts.ts`: `AdaptedInvalidateCallback<TTarget>` carries a `__restaleTarget` brand.
  - `sse-client.ts`: `SSEInvalidatorClient` constructor takes `ClientOptions` which has `target?: SignalTarget`. It does NOT accept `onInvalidate` — that's a `useReStale` concern.
  - The auto-inference of `target` from the adapter brand would have to happen in `useReStale` (the React hook), which reads `opts.onInvalidate.__restaleTarget` and passes it as `target` to `SSEInvalidatorClient`. This file was not read, so it cannot be confirmed.
- **Discrepancy:** The auto-inference claim is in `docs/client.md` under `useReStale`. `SSEInvalidatorClient` itself has no such inference (it requires explicit `target`). The docs accurately describe `useReStale` behavior but might mislead a reader of the vanilla client section.
- **Which source is correct:** Likely correct for `useReStale`; the vanilla `SSEInvalidatorClient` section does not claim auto-inference. Low confidence pending reading `useReStale`.
- **Recommended fix:** No change needed if `useReStale` implements the inference. If it doesn't, update docs. Flag for a human to verify `src/client/react/useReStale.ts`.
- **Severity:** low
- **Confidence:** low (requires reading `useReStale.ts` to confirm)
