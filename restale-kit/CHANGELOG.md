# Changelog

All notable changes to this package are documented here.

## [0.2.0] - 2026-07-17

- **Breaking Change**: Enforced encryption options configuration on `redisPubSubAdapter`, `ablyPubSubAdapter`, and `pusherPubSubAdapter`. Consumers must explicitly configure `{ encrypt: false }` or `{ encryptionKey: string }`.
- Added target-discriminated wire signals (`ReStaleSignal` union supporting `TanStackQuerySignal`, `SWRSignal`, `RTKQuerySignal`, and `GenericInvalidateSignal`) and `SIGNAL_TARGETS` export.
- Added native scalar string cache key matching for TanStack Query and SWR signal targets in `matchesInvalidateSignalKey`.
- Added AES-256-GCM symmetric payload encryption/decryption for distributed pub/sub adapters to prevent third-party providers from reading mutation keys and metadata.
- Implemented topic/channel name binding as Additional Authenticated Data (AAD) to bind ciphertexts to their topic/channel and prevent cross-topic relocation.
- Added throttled warning logs for decryption errors to handle key rotation mismatch or tampering gracefully without crashing.


## [0.1.0] - 2026-07-13

- Initial public release with SSE invalidation clients, server adapters, and pub/sub adapters.

