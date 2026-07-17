# Fix Batch 01: High Severity Findings

### [DISC-01-01] Wire signal type expansion (discriminated union) not documented in Spec or API Reference
- **Audit source:** `audit/1/shard_01_protocol-and-types.md`
- **Triage decision:** fix-now
- **Reasoning:** The discriminated union `ReStaleSignal` (`tanstack-query`, `swr`, `rtk-query`, `generic`) is the core signal model implemented and exported by `restale-kit`. The spec and API reference must accurately document these target payloads and `SIGNAL_TARGETS`.
- **Change made:** Updated `spec/sse-query-invalidate-contract.md` and `docs/api-reference.md` to document `ReStaleSignal` discriminated union, target signal interfaces, `SIGNAL_TARGETS`, and exported utility functions.
- **Tests:** Ran `restale-kit` unit tests; verified `protocol.test.ts` and `index-exports.test.ts`.
- **Status:** done
- **Follow-ups:** None.

### [DISC-04-01] Encryption specification (`PubSubEncryptionOptions`, AES-256-GCM, AAD binding) completely missing from PubSub Spec
- **Audit source:** `audit/1/shard_04_pubsub-adapters.md`
- **Triage decision:** fix-now
- **Reasoning:** AES-256-GCM encryption with AAD binding is a mandatory security contract implemented across all PubSub adapters (Redis, Ably, Pusher) and documented in `docs/pubsub.md`. It must be specified in `spec/pubsub-adapter-contract.md`.
- **Change made:** Updated `spec/pubsub-adapter-contract.md` with explicit `PubSubEncryptionOptions` specification, AES-256-GCM cipher format, CSPRNG IV, topic AAD binding, and `PubSubDecryptionError` error handling.
- **Tests:** Ran `restale-kit` unit tests; verified `envelope.test.ts`.
- **Status:** done
- **Follow-ups:** None.

