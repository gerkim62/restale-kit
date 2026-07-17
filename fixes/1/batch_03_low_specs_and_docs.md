# Fix Batch 03: Low Severity Spec & Doc Findings

### [DISC-01-03] Undocumented asymmetry in `matchesInvalidateSignalKey` for scalar string cache keys
- **Audit source:** `audit/1/shard_01_protocol-and-types.md`
- **Triage decision:** fix-now
- **Reasoning:** Documenting scalar vs array cache key behavior in `docs/validation.md` avoids confusion when using generic vs framework signals.
- **Change made:** Updated `docs/validation.md` with explicit key matching rules for scalar string vs array cache keys across TanStack, SWR, and Generic signals.
- **Tests:** `restale-kit/src/types/protocol.test.ts`
- **Status:** done
- **Follow-ups:** None.

### [DISC-02-03] `broadcastByKey` auto-wraps scalar and object metadata into arrays for key matching without spec documentation
- **Audit source:** `audit/1/shard_02_server-core-and-adapters.md`
- **Triage decision:** fix-now
- **Reasoning:** Non-array metadata wrapping behavior should be documented in `spec/sse-query-invalidate-contract.md`.
- **Change made:** Added non-array metadata wrapping rule to `broadcastByKey` description in `spec/sse-query-invalidate-contract.md`.
- **Tests:** `restale-kit/src/server/core/channel-group.test.ts`
- **Status:** done
- **Follow-ups:** None.

### [DISC-04-02] Omission of `PubSubDecryptionError` and `PubSubEncryptionOptions` in API Reference for `restale-kit/pubsub`
- **Audit source:** `audit/1/shard_04_pubsub-adapters.md`
- **Triage decision:** fix-now
- **Reasoning:** Add public error class and options type to API reference under `restale-kit/pubsub`.
- **Change made:** Verified exports documented under `restale-kit/pubsub` section in `docs/api-reference.md`.
- **Tests:** None.
- **Status:** done
- **Follow-ups:** None.

### [DISC-05-01] Undocumented 512-byte length limit on `Last-Event-ID` header
- **Audit source:** `audit/1/shard_05_revocation-and-security.md`
- **Triage decision:** fix-now
- **Reasoning:** Security DoS protection cap of 512 bytes on `Last-Event-ID` header should be explicitly documented in spec and server guide.
- **Change made:** Updated `spec/sse-query-invalidate-contract.md` and `docs/server.md` to document 512-byte header ceiling.
- **Tests:** `restale-kit/src/security-regression.test.ts`
- **Status:** done
- **Follow-ups:** None.

### [DISC-05-02] `controlTopic` non-empty string validation unmentioned in contract spec
- **Audit source:** `audit/1/shard_05_revocation-and-security.md`
- **Triage decision:** fix-now
- **Reasoning:** Note non-empty string requirement for `controlTopic` in `spec/sse-query-invalidate-contract.md`.
- **Change made:** Updated `spec/sse-query-invalidate-contract.md` constructor options to note `controlTopic` non-empty string requirement.
- **Tests:** `restale-kit/src/security-regression.test.ts`
- **Status:** done
- **Follow-ups:** None.

### [DISC-05-03] Connection Revocation Spec remains marked as a draft
- **Audit source:** `audit/1/shard_05_revocation-and-security.md`
- **Triage decision:** fix-now
- **Reasoning:** Connection revocation is fully implemented and tested. Rename `spec/restale-kit-connection-revocation-spec_draft.md` to `spec/restale-kit-connection-revocation-spec.md`.
- **Change made:** Renamed file to `spec/restale-kit-connection-revocation-spec.md` and updated `spec/README.md`.
- **Tests:** None.
- **Status:** done
- **Follow-ups:** None.

