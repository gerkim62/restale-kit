# Audit 2 Summary Report

## Overview & Action Directives

- **What to Trust:** The core implementation in `restale-kit/src/**/*` is robust, well-structured, and comprehensively tested. Wire protocol framing, SSE keepalives, event history replay buffers, Standard Schema integration, and PubSub AES-256-GCM encryption with topic AAD binding operate reliably as designed.
- **What to Edit:** Standardize documentation and specification details where discrepancies exist:
  1. Update `spec/sse-query-invalidate-contract.md` to clarify that `StandardSchemaV1` is re-exported from `restale-kit` as a type-only export.
  2. Replace references to `StandardSchema` with `StandardSchemaV1` across `docs/api-reference.md`, `docs/server.md`, `docs/client.md`, and `restale-kit/README.md`.
  3. Include `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, and `SIGNAL_TARGETS` in the contract spec export summary.
- **What to Build / Add:** Add `expect(SIGNAL_TARGETS).toBeDefined()` to `restale-kit/src/index-exports.test.ts`.

---

## Findings Grouped by Severity

### Medium Severity

- **`[AUDIT2-01-001]` Contradiction on StandardSchemaV1 export claim in spec vs index exports**
  - **Type:** contradiction
  - **Area:** `spec/sse-query-invalidate-contract.md:808-810`, `restale-kit/src/types/index.ts:3`, `docs/api-reference.md:10-20`
  - **Detail:** Spec claims `StandardSchemaV1` is not re-exported, but `restale-kit/src/types/index.ts` explicitly exports it as a type.
  - **Full Shard Detail:** [shard_01_spec-and-docs.md](./shard_01_spec-and-docs.md#audit2-01-001-contradiction-on-standardschemav1-export-claim-in-spec-vs-index-exports)

---

### Low Severity

- **`[AUDIT2-01-002]` Documentation uses `StandardSchema` instead of `StandardSchemaV1`**
  - **Type:** outdated-doc
  - **Area:** `docs/api-reference.md`, `docs/server.md`, `docs/client.md`, `restale-kit/README.md`, `restale-kit/src/types/standard-schema.ts:10`
  - **Detail:** Docs refer to the type parameter as `StandardSchema` / `StandardSchema<unknown, T>`, but the actual exported interface name is `StandardSchemaV1`.
  - **Full Shard Detail:** [shard_01_spec-and-docs.md](./shard_01_spec-and-docs.md#audit2-01-002-documentation-uses-standardschema-instead-of-standardschemav1)

- **`[AUDIT2-01-003]` Omission of protocol utility exports in contract spec export summary**
  - **Type:** outdated-doc
  - **Area:** `spec/sse-query-invalidate-contract.md:789-800`, `docs/api-reference.md:21-29`, `restale-kit/src/types/index.ts:17`
  - **Detail:** Contract spec summary table omits `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, and `SIGNAL_TARGETS` from exported symbols.
  - **Full Shard Detail:** [shard_01_spec-and-docs.md](./shard_01_spec-and-docs.md#audit2-01-003-omission-of-protocol-utility-exports-in-contract-spec-export-summary)

- **`[AUDIT2-01-004]` `TanStackQuerySignal.exact` type discrepancy in contract spec vs implementation**
  - **Type:** implementation-drift
  - **Area:** `spec/sse-query-invalidate-contract.md:117`, `restale-kit/src/types/protocol.ts:25`
  - **Detail:** Spec defines `exact?: boolean`, while code types `exact` as `QueryFilters['exact']`.
  - **Full Shard Detail:** [shard_01_spec-and-docs.md](./shard_01_spec-and-docs.md#audit2-01-004-tanstackquerysignalexact-type-discrepancy-in-contract-spec-vs-implementation)

- **`[AUDIT2-02-001]` Missing test assertion for `SIGNAL_TARGETS` in `index-exports.test.ts`**
  - **Type:** missing-test
  - **Area:** `restale-kit/src/types/index.ts:17`, `restale-kit/src/index-exports.test.ts:40-47`
  - **Detail:** `SIGNAL_TARGETS` is exported from root index, but `index-exports.test.ts` does not assert its presence.
  - **Full Shard Detail:** [shard_02_types-protocol-utils.md](./shard_02_types-protocol-utils.md#audit2-02-001-missing-test-assertion-for-signaltargets-in-index-exportstestts)

- **`[AUDIT2-02-002]` Generic signals reject scalar string cache keys in `matchesInvalidateSignalKey`**
  - **Type:** undocumented-behavior
  - **Area:** `restale-kit/src/types/protocol.ts:94-131`, `spec/sse-query-invalidate-contract.md:137-142`, `docs/validation.md:26`
  - **Detail:** Spec does not explicitly note that scalar string cache keys return `false` for generic signals.
  - **Full Shard Detail:** [shard_02_types-protocol-utils.md](./shard_02_types-protocol-utils.md#audit2-02-002-generic-signals-reject-scalar-string-cache-keys-in-matchesinvalidatesignalkey)

- **`[AUDIT2-03-001]` Verified agreement on `SSEChannelGroup` and transport adapters channel management**
  - **Type:** undocumented-behavior
  - **Area:** `restale-kit/src/server/core/channel.ts`, `channel-group.ts`, `express/index.ts`, `fastify/index.ts`, `fetch/response.ts`
  - **Detail:** Verified channel closing, Fastify `reply.hijack()` auto-invocation, and 512-byte Last-Event-ID header length cap.
  - **Full Shard Detail:** [shard_03_server-core-and-adapters.md](./shard_03_server-core-and-adapters.md#audit2-03-001-verified-agreement-on-ssechannelgroup-and-transport-adapters-channel-management)

- **`[AUDIT2-04-001]` Verified agreement across Client SSE core and framework adapters**
  - **Type:** undocumented-behavior
  - **Area:** `restale-kit/src/client/core/sse-client.ts`, `validation.ts`, `useReStale.ts`, `swr/adapter.ts`, `tanstack-query/adapter.ts`
  - **Detail:** Verified terminal revocation handling, unmount state transitions, and cache adapter signal mappings.
  - **Full Shard Detail:** [shard_04_client-core-and-frameworks.md](./shard_04_client-core-and-frameworks.md#audit2-04-001-verified-agreement-across-client-sse-core-and-framework-adapters)

- **`[AUDIT2-05-001]` Verified agreement on PubSub encryption contract and self-echo suppression**
  - **Type:** undocumented-behavior
  - **Area:** `restale-kit/src/pubsub/core/envelope.ts`, `ably/index.ts`, `pusher/index.ts`, `redis/index.ts`
  - **Detail:** Verified key validation rules, AES-256-GCM cipher with topic AAD binding, and adapter echo suppression.
  - **Full Shard Detail:** [shard_05_pubsub-adapters-and-security.md](./shard_05_pubsub-adapters-and-security.md#audit2-05-001-verified-agreement-on-pubsub-encryption-contract-and-self-echo-suppression)

- **`[AUDIT2-06-001]` Verified agreement on build scripts and example runners**
  - **Type:** undocumented-behavior
  - **Area:** `scripts/run-example.mjs`, `scripts/verify-package.mjs`, `package.json`, `examples/`
  - **Detail:** Verified 15-entrypoint smoke imports script and multi-stack example runner mappings.
  - **Full Shard Detail:** [shard_06_examples-scripts-and-configs.md](./shard_06_examples-scripts-and-configs.md#audit2-06-001-verified-agreement-on-build-scripts-and-example-runners)
