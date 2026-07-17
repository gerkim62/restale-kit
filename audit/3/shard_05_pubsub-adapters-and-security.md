# Audit 3 Shard 05: PubSub Adapters, Security Regression, and Test Fixtures

## Reviewed Sources
- `restale-kit/src/pubsub/core/index.ts`
- `restale-kit/src/pubsub/core/envelope.ts`
- `restale-kit/src/pubsub/core/envelope.test.ts`
- `restale-kit/src/pubsub/core/pubsub-utils.ts`
- `restale-kit/src/pubsub/ably/index.ts`
- `restale-kit/src/pubsub/ably/ably.test.ts`
- `restale-kit/src/pubsub/pusher/index.ts`
- `restale-kit/src/pubsub/pusher/pusher.test.ts`
- `restale-kit/src/pubsub/redis/index.ts`
- `restale-kit/src/pubsub/redis/redis.test.ts`
- `restale-kit/src/security-regression.test.ts`
- `restale-kit/src/security-regression-hook.test.ts`
- `restale-kit/src/test-fixtures/event-source.ts`
- `restale-kit/src/test-fixtures/pubsub.ts`
- `restale-kit/src/test-fixtures/schemas.ts`

---

### [AUDIT3-05-01] Agreement Check: Encryption Options, AES-256-GCM AAD Binding & PubSub Adapters
- **Area:** `restale-kit/src/pubsub/**/*` & `restale-kit/src/security-*.ts`
- **Type:** agreement
- **Evidence:**
  - `envelope.ts`: `validateEncryptionOptions` enforces mandatory explicit configuration (`encrypt: false` or `encryptionKey: string >=32 bytes`). AES-256-GCM encryption binds topic string as AAD. `PubSubDecryptionError` is thrown on invalid tag/ciphertext.
  - `redis/index.ts`, `ably/index.ts`, `pusher/index.ts`: All adapters validate encryption options up front, preserve batch array structures (`PubSubMessage`), handle self-echo suppression (instance ID envelope tag or native echo suppression), and delegate decryption errors to throttled warning logs (`createDecryptionErrorHandler`).
  - `security-regression.test.ts` & `security-regression-hook.test.ts`: Comprehensively cover security findings (connectionId scope-pinning contract, eventStore non-duplication, JSON NaN/Infinity rejection, lastEventId length limits, controlTopic validation, multi-line framing, and React hook client lifecycle).
- **Discrepancy:** None. Implementation, tests, and documentation are fully consistent.
- **Which source is correct / should be trusted:** Implementation.
- **Recommended fix:** No action required.
- **Severity:** low
- **Confidence:** high
