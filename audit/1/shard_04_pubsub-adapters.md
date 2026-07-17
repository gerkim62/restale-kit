# Audit Shard 04: PubSub Adapters

## Scope
- Spec: `spec/pubsub-adapter-contract.md`
- Docs: `docs/pubsub.md`, `docs/api-reference.md`, `README.md`
- Code:
  - `restale-kit/src/pubsub/core/envelope.ts`
  - `restale-kit/src/pubsub/core/pubsub-utils.ts`
  - `restale-kit/src/pubsub/redis/index.ts`
  - `restale-kit/src/pubsub/ably/index.ts`
  - `restale-kit/src/pubsub/pusher/index.ts`
- Tests:
  - `restale-kit/src/pubsub/core/envelope.test.ts`
  - `restale-kit/src/pubsub/core/pubsub-utils.test.ts`
  - `restale-kit/src/pubsub/redis/index.test.ts`
  - `restale-kit/src/pubsub/ably/index.test.ts`
  - `restale-kit/src/pubsub/pusher/index.test.ts`

---

## Discrepancies

### [DISC-04-01] Encryption specification (`PubSubEncryptionOptions`, AES-256-GCM, AAD binding) completely missing from PubSub Spec
- **Area:** `spec/pubsub-adapter-contract.md`, `docs/pubsub.md:L29-L44`, `restale-kit/src/pubsub/core/envelope.ts:L47-L132`
- **Type:** spec-not-implemented
- **Evidence:**
  - `spec/pubsub-adapter-contract.md`: The specification doc contains zero mention of encryption options, `encryptionKey`, `encrypt: false`, AES-256-GCM, or topic-based Additional Authenticated Data (AAD) binding.
  - `docs/pubsub.md:L29-L44`:
    Documents mandatory `PubSubEncryptionOptions` requiring either `{ encrypt: false }` or `{ encryptionKey: string }` with AES-256-GCM and CSPRNG key requirements.
  - `restale-kit/src/pubsub/core/envelope.ts:L47-L132`:
    Implementation enforces `validateEncryptionOptions` on all adapters (Redis, Ably, Pusher) and binds AAD to `topic` during AES-256-GCM cipher operations.
- **Discrepancy:** The PubSub contract spec in `spec/pubsub-adapter-contract.md` has not been updated to include the security and encryption contract introduced across all PubSub adapters.
- **Which source is correct / should be trusted:** Implementation (`envelope.ts`) and `docs/pubsub.md`.
- **Recommended fix:** Update `spec/pubsub-adapter-contract.md` to specify the mandatory encryption options, key format validation (hex >=64 chars or base64 >=44 chars), AES-256-GCM cipher format (`iv:authTag:encrypted`), and AAD binding rules.
- **Severity:** high
- **Confidence:** high

### [DISC-04-02] Omission of `PubSubDecryptionError` and `PubSubEncryptionOptions` in API Reference for `restale-kit/pubsub`
- **Area:** `spec/pubsub-adapter-contract.md:L26-L41`, `docs/api-reference.md:L470-L485`, `restale-kit/src/pubsub/core/envelope.ts:L5`
- **Type:** outdated-doc
- **Evidence:**
  - `restale-kit/src/pubsub/core/envelope.ts:L5`: `PubSubDecryptionError` is exported and thrown when decryption fails.
  - `docs/api-reference.md:L470-L485`: Lists `PubSubAdapter` interface but omits `PubSubDecryptionError` and `PubSubEncryptionOptions`.
- **Discrepancy:** `PubSubDecryptionError` and `PubSubEncryptionOptions` are exported public types/classes under `restale-kit/pubsub` but missing from the API reference documentation.
- **Which source is correct / should be trusted:** Implementation.
- **Recommended fix:** Add `PubSubDecryptionError` and `PubSubEncryptionOptions` to `docs/api-reference.md` under `restale-kit/pubsub`.
- **Severity:** low
- **Confidence:** high

---

## Verified Correct Behavior (Agreements)
- All PubSub adapters (Redis, Ably, Pusher) accept pre-constructed client instances rather than connection strings or credentials.
- Envelope wrapping (`wrapEnvelope`) injects a unique instance origin ID to suppress self-echoes without mutating signal payloads.
- Multi-signal array batching (`{ kind: 'signal', data: TSignal[] }`) is preserved end-to-end without flattening across all adapters.
- Control messages (`{ kind: 'control', data: JSONValue }`) use dedicated topic/event discriminators (`PUBSUB_EVENTS.CONTROL` on Pusher, standard `PubSubMessage` envelope on Redis and Ably).
