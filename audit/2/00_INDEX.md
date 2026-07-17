# Audit 2 Index

## Inventory & Source of Truth Mapping

- **Spec (5 files):** `spec/README.md`, `spec/folder-structure.md`, `spec/sse-query-invalidate-contract.md`, `spec/pubsub-adapter-contract.md`, `spec/restale-kit-connection-revocation-spec.md`
- **Docs (7 files + root/pkg READMEs):** `README.md`, `docs/README.md`, `docs/getting-started.md`, `docs/api-reference.md`, `docs/client.md`, `docs/server.md`, `docs/pubsub.md`, `docs/validation.md`, `restale-kit/README.md`, `restale-kit/CHANGELOG.md`
- **Implementation (Types/Utils/Server/Client/PubSub/Examples/Scripts):** `restale-kit/src/**/*`, `examples/**/*`, `scripts/*`
- **Tests:** `restale-kit/src/**/*.test.ts`, `vitest-testing-plan.md`

## Shard Plan

| Shard File | Description | Status |
| --- | --- | --- |
| `shard_01_spec-and-docs.md` | Core specifications vs documentation consistency | done |
| `shard_02_types-protocol-utils.md` | Types, protocol schemas, errors, utilities, export contracts | done |
| `shard_03_server-core-and-adapters.md` | Server channels, groups, event store, framing, web framework adapters | done |
| `shard_04_client-core-and-frameworks.md` | Client SSE core, backoff, validation, React, SWR, TanStack Query integration | done |
| `shard_05_pubsub-adapters-and-security.md` | PubSub core, Ably, Pusher, Redis adapters, crypto security, test fixtures | done |
| `shard_06_examples-scripts-and-configs.md` | Example applications, build/verify scripts, workspace configs | done |
