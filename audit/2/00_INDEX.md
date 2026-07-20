# Audit 2 — Index

**Focus:** Frame Guard (restale-kit-frame-guard-spec, usage-matrix) vs docs, implementation, and tests.
**Status:** Complete

---

## Source-of-truth inventory

| Layer | Locations |
|---|---|
| **Spec** | `spec/restale-kit-frame-guard-spec (7).md`, `spec/restale-kit-frame-guard-usage-matrix (1).md`, `spec/sse-query-invalidate-contract.md`, `spec/restale-kit-connection-revocation-spec.md`, `spec/pubsub-adapter-contract.md`, `spec/client-target-negotiation.md` |
| **Docs** | `docs/server.md`, `docs/client.md`, `docs/getting-started.md`, `docs/api-reference.md`, `docs/pubsub.md`, `docs/validation.md` |
| **Implementation** | `restale-kit/src/server/core/channel.ts`, `framing.ts`, `channel-group.ts`, `merge-channel-defaults.ts`; `client/core/sse-client.ts`, `client-contracts.ts`; `types/protocol.ts`; `utils/constants.ts` |
| **Tests** | `server/core/channel.test.ts`, `framing.test.ts`, `channel-group.test.ts`, `merge-channel-defaults.test.ts`; `client/core/sse-client.test.ts` |

---

## Shard plan

| Shard | Scope | Status |
|---|---|---|
| `shard_frame-guard-spec-vs-impl.md` | Frame Guard server-side spec §§1–7 vs implementation | **done** |
| `shard_frame-guard-client.md` | Frame Guard client-side spec (renew frame, §4.1.2–4.1.6) vs sse-client.ts | **done** |
| `shard_frame-guard-docs.md` | Frame Guard coverage in docs/server.md, docs/client.md, README, api-reference | **done** |
| `shard_frame-guard-tests.md` | Test coverage audit for Frame Guard — gaps, wrong assertions, spec-violating expectations | **done** |
| `shard_general-contract.md` | Non-Frame-Guard contract (wire protocol, pubsub, revocation, target negotiation) vs implementation | **done** |

---

## Cross-shard references

- FG-01 (merge semantics) → shard_frame-guard-spec-vs-impl.md
- FG-07 (client maxAttempts floor) → shard_frame-guard-client.md, shard_frame-guard-tests.md (test comments acknowledge the violation)
- FG-10 (docs missing Frame Guard) → shard_frame-guard-docs.md
- GC-03 (SSEChannelOptions in spec lacks Frame Guard fields) → shard_general-contract.md
