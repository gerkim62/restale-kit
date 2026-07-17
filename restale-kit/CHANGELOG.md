# Changelog

All notable changes to this package are documented here.

## [0.2.0] - 2026-07-17

- **Breaking Change**: Enforced encryption options configuration on `redisPubSubAdapter`, `ablyPubSubAdapter`, and `pusherPubSubAdapter`. Consumers must explicitly configure `{ encrypt: false }` or `{ encryptionKey: string }`.
- Added AES-256-GCM symmetric payload encryption/decryption for distributed pub/sub adapters to prevent third-party providers from reading mutation keys and metadata.
- Implemented topic/channel name binding as Additional Authenticated Data (AAD) to prevent replay/relocation attacks.
- Added throttled warning logs for decryption errors to handle key rotation mismatch or tampering gracefully without crashing.

## [0.1.0] - 2026-07-13

- Initial public release with SSE invalidation clients, server adapters, and pub/sub adapters.

