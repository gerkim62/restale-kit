# Verification Index (Session 1)

## Verification Batch Plan

| Verification File | Source Audit Shard | Scope / Description | Status |
| --- | --- | --- | --- |
| `verify/1/verify_shard_01_protocol-and-types.md` | `audit/1/shard_01_protocol-and-types.md` | Re-verification of protocol discriminated union, utility exports, and key matching rules | done |
| `verify/1/verify_shard_02_server-core-and-adapters.md` | `audit/1/shard_02_server-core-and-adapters.md` | Re-verification of SSEChannel.revoke, eventStore sharing, and broadcastByKey metadata wrapping | done |
| `verify/1/verify_shard_03_client-core-and-adapters.md` | `audit/1/shard_03_client-core-and-adapters.md` | Re-verification of TanStack Query / SWR adapter actions and client revocation status | done |
| `verify/1/verify_shard_04_pubsub-adapters.md` | `audit/1/shard_04_pubsub-adapters.md` | Re-verification of PubSub encryption specification and PubSubDecryptionError API reference export | done |
| `verify/1/verify_shard_05_revocation-and-security.md` | `audit/1/shard_05_revocation-and-security.md` | Re-verification of 512-byte Last-Event-ID ceiling, non-empty controlTopic, and draft spec status | done |
| `verify/1/verify_shard_06_examples-and-scripts.md` | `audit/1/shard_06_examples-and-scripts.md` | Re-verification of Vercel Redis redundant req.once('close') and Fastify meta predicate typing | done |
| `verify/1/verify_shard_07_package-manifest-and-meta-specs.md` | `audit/1/shard_07_package-manifest-and-meta-specs.md` | Re-verification of vitest testing plan replay mechanics, CHANGELOG v0.2.0, and folder structure diagram | done |
