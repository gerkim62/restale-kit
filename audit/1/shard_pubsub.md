# Audit Ledger Shard: PubSub

## Inventory Covered
- `spec/pubsub-adapter-contract.md`
- `docs/pubsub.md`
- `docs/api-reference.md` (`restale-kit/pubsub`, `/redis`, `/ably`, `/pusher` sections)
- `restale-kit/src/pubsub/core/envelope.ts`
- `restale-kit/src/pubsub/core/pubsub-utils.ts`
- `restale-kit/src/pubsub/core/index.ts`
- `restale-kit/src/pubsub/redis/index.ts`
- `restale-kit/src/pubsub/ably/index.ts`
- `restale-kit/src/pubsub/pusher/index.ts`
- `restale-kit/src/pubsub/core/pubsub-utils.test.ts`
- `restale-kit/src/pubsub/core/envelope.test.ts`
- `restale-kit/src/pubsub/redis/index.test.ts`
- `restale-kit/src/pubsub/ably/index.test.ts`
- `restale-kit/src/pubsub/pusher/index.test.ts`

---

### [FINDING-006] Agreement verification: PubSub contract, encryption options, AAD binding, and adapter implementations
- **Area:** `spec/pubsub-adapter-contract.md`, `docs/pubsub.md`, `docs/api-reference.md`, `restale-kit/src/pubsub/*`
- **Status:** PASS / Agreed
- **Notes:**
  - `PubSubAdapter` interface: `publish`, `subscribe`, `onError`, `PubSubMessage` envelope (`signal` | `control`).
  - Encryption contract: Mandatory explicit options (`{ encrypt: false }` or `{ encryptionKey }`), 32+ byte CSPRNG key requirement, AES-256-GCM with topic AAD binding, rate-throttled `PubSubDecryptionError` warnings via `createDecryptionErrorHandler`.
  - Redis adapter: `client.duplicate()`, self-echo suppression via origin tag, duplicate subscription prevention.
  - Ably adapter: Internal origin tag or native echo suppression (`echoMessages: false`).
  - Pusher adapter: Webhook signature verification & dispatch via `handleWebhook`.
