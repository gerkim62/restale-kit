# Fix Check Batch 03: Low Severity Specs & Docs

## Re-Verification Entries

### [DISC-01-03] Undocumented asymmetry in `matchesInvalidateSignalKey` for scalar string cache keys
- **Fix source:** `fixes/1/batch_03_low_specs_and_docs.md`
- **Original claim:** Documented key matching rules for scalar vs array cache keys in `docs/validation.md`.
- **Re-verified change:** `docs/validation.md:L80-L100` details scalar key matching semantics across signal target types.
- **Discrepancy resolved?** yes
- **Test verification:** `protocol.test.ts` passes.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-02-03] `broadcastByKey` auto-wraps scalar and object metadata into arrays for key matching without spec documentation
- **Fix source:** `fixes/1/batch_03_low_specs_and_docs.md`
- **Original claim:** Documented scalar/object metadata wrapping in `spec/sse-query-invalidate-contract.md`.
- **Re-verified change:** `spec/sse-query-invalidate-contract.md:L400-L408` documents auto-wrapping of non-array metadata during broadcast.
- **Discrepancy resolved?** yes
- **Test verification:** `channel-group.test.ts` passes.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-04-02] Omission of `PubSubDecryptionError` and `PubSubEncryptionOptions` in API Reference for `restale-kit/pubsub`
- **Fix source:** `fixes/1/batch_03_low_specs_and_docs.md`
- **Original claim:** Added `PubSubDecryptionError` and `PubSubEncryptionOptions` to `docs/api-reference.md`.
- **Re-verified change:** `docs/api-reference.md:L470-L495` contains both public exports.
- **Discrepancy resolved?** yes
- **Test verification:** `envelope.test.ts` passes.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-05-01] Undocumented 512-byte length limit on `Last-Event-ID` header
- **Fix source:** `fixes/1/batch_03_low_specs_and_docs.md`
- **Original claim:** Documented 512-byte `Last-Event-ID` header ceiling in `spec/sse-query-invalidate-contract.md` and `docs/server.md`.
- **Re-verified change:** `spec/sse-query-invalidate-contract.md:L275-L280` and `docs/server.md:L298-L305` document header ceiling.
- **Discrepancy resolved?** yes
- **Test verification:** `security-regression.test.ts` passes.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-05-02] `controlTopic` non-empty string validation unmentioned in contract spec
- **Fix source:** `fixes/1/batch_03_low_specs_and_docs.md`
- **Original claim:** Documented non-empty string validation for `controlTopic` in `spec/sse-query-invalidate-contract.md`.
- **Re-verified change:** `spec/sse-query-invalidate-contract.md:L348-L352` specifies string validation requirements.
- **Discrepancy resolved?** yes
- **Test verification:** `security-regression.test.ts` passes.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-05-03] Connection Revocation Spec remains marked as a draft
- **Fix source:** `fixes/1/batch_03_low_specs_and_docs.md`
- **Original claim:** Renamed `spec/restale-kit-connection-revocation-spec_draft.md` to `spec/restale-kit-connection-revocation-spec.md` and updated `spec/README.md`.
- **Re-verified change:** Spec file exists at non-draft path `spec/restale-kit-connection-revocation-spec.md` and `spec/README.md` links to it.
- **Discrepancy resolved?** yes
- **Test verification:** Manual file path resolution verified.
- **Collateral check:** none found
- **Verdict:** pass
- **Follow-up needed:** none
