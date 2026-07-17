# Audit Shard 05: PubSub Adapters, Cryptographic Security, and Test Fixtures

### [AUDIT2-05-001] Verified agreement on PubSub encryption contract and self-echo suppression
- **Area:** `restale-kit/src/pubsub/core/envelope.ts`, `restale-kit/src/pubsub/ably/index.ts`, `restale-kit/src/pubsub/pusher/index.ts`, `restale-kit/src/pubsub/redis/index.ts`, `restale-kit/src/security-regression.test.ts`, `spec/pubsub-adapter-contract.md`, `docs/pubsub.md`
- **Type:** undocumented-behavior
- **Evidence:**
  - `restale-kit/src/pubsub/core/envelope.ts:22-42`: Strictly validates hex (>=64 chars) or base64 (>=44 chars) keys decoding to >= 32 bytes.
  - `restale-kit/src/pubsub/core/envelope.ts:80-132`: Uses AES-256-GCM with a fresh 12-byte IV per message and binds topic string as AAD.
  - `restale-kit/src/pubsub/ably/index.ts:57-64`: Enforces explicit `echoMessages: false` on Ably client when `useNativeEchoSuppression: true` is configured.
- **Discrepancy:** None — behavior is consistent across spec, docs, tests, and implementation.
- **Which source is correct / should be trusted:** Implementation matches specification and documentation.
- **Recommended fix:** No code changes needed.
- **Severity:** low
- **Confidence:** high
