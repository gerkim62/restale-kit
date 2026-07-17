# Verification Shard 05: Revocation & Security

## Findings Re-Verification

### [DISC-05-01] Undocumented 512-byte length limit on `Last-Event-ID` header
- **Audit claim:** 512-byte limit on `Last-Event-ID` in `transport-utils.ts` omitted from spec and docs.
- **Re-checked evidence:**
  - `restale-kit/src/server/transport-utils.ts:L8-L59`: Enforces 512-byte cap and logs warning.
  - `restale-kit/src/security-regression.test.ts:L451-L511`: Unit tests verify header length truncation.
- **Verdict:** confirmed
- **Reasoning:** Security boundary protection was unmentioned in specifications.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-05-02] `controlTopic` non-empty string validation unmentioned in contract spec
- **Audit claim:** `controlTopic` non-empty string validation in `channel-group.ts` omitted from spec.
- **Re-checked evidence:**
  - `restale-kit/src/server/core/channel-group.ts:L178-L184`: Throws if `controlTopic` is empty or whitespace.
- **Verdict:** confirmed
- **Reasoning:** Validation constraint present in code and tests, missing in spec.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-05-03] Connection Revocation Spec remains marked as a draft
- **Audit claim:** Revocation spec retained `_draft.md` suffix despite full implementation.
- **Re-checked evidence:**
  - `spec/restale-kit-connection-revocation-spec_draft.md`: Pre-fix file path.
- **Verdict:** confirmed
- **Reasoning:** Draft filename was obsolete.
- **Correction (if any):** None.
- **Confidence:** high
