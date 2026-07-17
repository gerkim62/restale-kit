# Audit Shard 05: Revocation & Security

## Scope
- Spec: `spec/restale-kit-connection-revocation-spec_draft.md`, `spec/sse-query-invalidate-contract.md`
- Docs: `docs/server.md`, `docs/pubsub.md`, `docs/api-reference.md`, `README.md`
- Code:
  - `restale-kit/src/server/core/channel-group.ts`
  - `restale-kit/src/server/transport-utils.ts`
  - `restale-kit/src/client/core/sse-client.ts`
  - `restale-kit/src/client/react/useReStale.ts`
- Tests:
  - `restale-kit/src/security-regression.test.ts`
  - `restale-kit/src/security-regression-hook.test.ts`

---

## Discrepancies

### [DISC-05-01] Undocumented 512-byte length limit on `Last-Event-ID` header
- **Area:** `spec/sse-query-invalidate-contract.md:L270-L274`, `docs/server.md:L298`, `restale-kit/src/server/transport-utils.ts:L8-L59`
- **Type:** undocumented-behavior
- **Evidence:**
  - `restale-kit/src/server/transport-utils.ts:L8-L59`:
    ```ts
    const MAX_LAST_EVENT_ID_LENGTH = 512
    if (value.length > MAX_LAST_EVENT_ID_LENGTH) {
      console.warn('[WARN][extractLastEventId] Last-Event-ID header exceeds maximum length of 512 bytes...')
      return undefined
    }
    ```
  - `restale-kit/src/security-regression.test.ts:L451-L511`:
    Verifies that headers longer than 512 bytes return `undefined` to prevent DoS via expensive buffer scans.
- **Discrepancy:** The 512-byte ceiling on `Last-Event-ID` headers is enforced in transport utils and tested in security regression tests, but is not mentioned in `spec/sse-query-invalidate-contract.md` or `docs/server.md`.
- **Which source is correct / should be trusted:** Implementation (`transport-utils.ts`). It is a security defense mechanism against ring buffer scanning DoS.
- **Recommended fix:** Document the 512-byte `Last-Event-ID` cap in `spec/sse-query-invalidate-contract.md` under event history replay and in `docs/server.md`.
- **Severity:** low
- **Confidence:** high

### [DISC-05-02] `controlTopic` non-empty string validation unmentioned in contract spec
- **Area:** `spec/sse-query-invalidate-contract.md:L346`, `docs/api-reference.md:L116`, `restale-kit/src/server/core/channel-group.ts:L178-L184`
- **Type:** undocumented-behavior
- **Evidence:**
  - `restale-kit/src/server/core/channel-group.ts:L178-L184`:
    ```ts
    if (typeof rawControlTopic !== 'string' || rawControlTopic.trim() === '') {
      throw new Error('[SSEChannelGroup] controlTopic must be a non-empty, non-whitespace string...')
    }
    ```
  - `restale-kit/src/security-regression.test.ts:L338-L359`:
    Verifies constructor throws when `controlTopic` is `''`, `'   '`, or `'\t'`.
- **Discrepancy:** The constructor validation rejecting empty or whitespace-only `controlTopic` strings is tested and enforced in code, but omitted from `spec/sse-query-invalidate-contract.md`.
- **Which source is correct / should be trusted:** Implementation (`channel-group.ts`).
- **Recommended fix:** Update `spec/sse-query-invalidate-contract.md` to note that `controlTopic` must be a non-empty string.
- **Severity:** low
- **Confidence:** high

### [DISC-05-03] Connection Revocation Spec remains marked as a draft
- **Area:** `spec/restale-kit-connection-revocation-spec_draft.md`, `spec/sse-query-invalidate-contract.md:L419-L430`
- **Type:** outdated-doc
- **Evidence:**
  - `spec/restale-kit-connection-revocation-spec_draft.md`: The file name retains `_draft` and section 1 states the specification goals.
  - The implementation in `channel-group.ts`, `sse-client.ts`, and `useReStale.ts` fully supports all features described in the draft (`revokeWhere`, `revokeByConnectionId`, scope matching, terminal `event: revoke` frames, `onRevoke` callbacks).
- **Discrepancy:** Revocation functionality is fully implemented and released, but the dedicated specification file is still named `restale-kit-connection-revocation-spec_draft.md`.
- **Which source is correct / should be trusted:** Implementation.
- **Recommended fix:** Rename `spec/restale-kit-connection-revocation-spec_draft.md` to `spec/restale-kit-connection-revocation-spec.md` and fold its security scope recommendations into `spec/sse-query-invalidate-contract.md`.
- **Severity:** low
- **Confidence:** high

---

## Verified Correct Behavior (Agreements)
- `revokeWhere` and `revokeByConnectionId` enforce scope-pinning security constraints and structural deep equality matching against channel metadata.
- Channels registered with `undefined` metadata are safely excluded from criteria-based matching (`revokeWhere`) to prevent accidental blanket revocations.
- `useReStale` defers `SSEInvalidatorClient` instantiation using `urlRef` and `useEffect` post-commit cleanup to prevent client orphaning under React Concurrent Mode and Strict Mode double renders (`security-regression-hook.test.ts`).
- `formatInvalidateFrame` sanitizes event IDs to strip `\r` and `\n` characters to prevent header injection attacks.
