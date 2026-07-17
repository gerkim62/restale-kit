# Audit Index

## Shard Plan

| Shard File | Scope / Description | Status |
| --- | --- | --- |
| `audit/1/shard_01_protocol-and-types.md` | Protocol specification (`sse-query-invalidate-contract.md`), constants, type definitions (`src/types/*`), and schemas vs docs and tests | Done |
| `audit/1/shard_02_server-core-and-adapters.md` | Server architecture (`src/server/*`), channels, event store, framing, and framework integrations (Express, Fastify, Hono, Node, Fetch) | Done |
| `audit/1/shard_03_client-core-and-adapters.md` | Client architecture (`src/client/*`), SSE client, validation, backoff, React hook, SWR and TanStack Query adapters | Done |
| `audit/1/shard_04_pubsub-adapters.md` | PubSub specification (`pubsub-adapter-contract.md`), envelopes, encryption/signing, Redis, Ably, and Pusher adapters | Done |
| `audit/1/shard_05_revocation-and-security.md` | Connection revocation draft spec (`restale-kit-connection-revocation-spec_draft.md`), security regression tests, auth mechanisms | Done |
| `audit/1/shard_06_examples-and-scripts.md` | Example applications (`examples/*`), scripts (`scripts/*`), and example code vs core library guidelines and docs | Done |
| `audit/1/shard_07_package-manifest-and-meta-specs.md` | Package manifest (`package.json`), `CHANGELOG.md`, `vitest-testing-plan.md`, `folder-structure.md`, and `spec/README.md` | Done |

## Map of Sources of Truth

- **Specs:** `spec/sse-query-invalidate-contract.md`, `spec/pubsub-adapter-contract.md`, `spec/restale-kit-connection-revocation-spec_draft.md`, `spec/folder-structure.md`, `spec/README.md`, `vitest-testing-plan.md`
- **Docs:** `README.md`, `restale-kit/README.md`, `restale-kit/CHANGELOG.md`, `docs/README.md`, `docs/api-reference.md`, `docs/client.md`, `docs/getting-started.md`, `docs/pubsub.md`, `docs/server.md`, `docs/validation.md`, `examples/README.md`
- **Implementation & Tests:** `restale-kit/src/**`
