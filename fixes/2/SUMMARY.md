# Fixes 2 Summary Report

## Overview & Status Counts

All 10 audit findings from Audit 2 have been fully triaged, resolved, and verified.

### Status Counts by Severity

| Severity | Total Findings | Fixed / Resolved | Deferred | Rejected | Needs Human Decision |
| --- | --- | --- | --- | --- | --- |
| **Medium** | 1 | 1 | 0 | 0 | 0 |
| **Low** | 9 | 9 | 0 | 0 | 0 |
| **Total** | **10** | **10** | **0** | **0** | **0** |

---

## Actioned Findings Summary

### Medium Severity

- **`[AUDIT2-01-001]` Contradiction on StandardSchemaV1 export claim in spec vs index exports**
  - **Decision:** `fix-now` (`done`)
  - **Resolution:** Updated `spec/sse-query-invalidate-contract.md` to document that `StandardSchemaV1` is re-exported from `restale-kit` as a type-only export, and added `StandardSchemaV1` to `docs/api-reference.md`.
  - **Batch:** [`batch_01_spec-and-docs.md`](./batch_01_spec-and-docs.md#audit2-01-001-contradiction-on-standardschemav1-export-claim-in-spec-vs-index-exports)

---

### Low Severity

- **`[AUDIT2-01-002]` Documentation uses `StandardSchema` instead of `StandardSchemaV1`**
  - **Decision:** `fix-now` (`done`)
  - **Resolution:** Replaced all references to `StandardSchema` with `StandardSchemaV1` in `docs/api-reference.md`, `docs/server.md`, `docs/client.md`, and `restale-kit/README.md`.
  - **Batch:** [`batch_01_spec-and-docs.md`](./batch_01_spec-and-docs.md#audit2-01-002-documentation-uses-standardschema-instead-of-standardschemav1)

- **`[AUDIT2-01-003]` Omission of protocol utility exports in contract spec export summary**
  - **Decision:** `fix-now` (`done`)
  - **Resolution:** Updated `spec/sse-query-invalidate-contract.md` to list `isJSONValue`, `isJSONValueArray`, `matchesInvalidateSignalKey`, `validateStandardSchema`, and `SIGNAL_TARGETS` in the export table.
  - **Batch:** [`batch_01_spec-and-docs.md`](./batch_01_spec-and-docs.md#audit2-01-003-omission-of-protocol-utility-exports-in-contract-spec-export-summary)

- **`[AUDIT2-01-004]` `TanStackQuerySignal.exact` type discrepancy in contract spec vs implementation**
  - **Decision:** `fix-now` (`done`)
  - **Resolution:** Updated `spec/sse-query-invalidate-contract.md` `TanStackQuerySignal.exact` type to `QueryFilters['exact']`.
  - **Batch:** [`batch_01_spec-and-docs.md`](./batch_01_spec-and-docs.md#audit2-01-004-tanstackquerysignalexact-type-discrepancy-in-contract-spec-vs-implementation)

- **`[AUDIT2-02-001]` Missing test assertion for `SIGNAL_TARGETS` in `index-exports.test.ts`**
  - **Decision:** `fix-now` (`done`)
  - **Resolution:** Added `expect(SIGNAL_TARGETS).toBeDefined()` to `restale-kit/src/index-exports.test.ts`.
  - **Batch:** [`batch_02_types-and-tests.md`](./batch_02_types-and-tests.md#audit2-02-001-missing-test-assertion-for-signaltargets-in-index-exportstestts)

- **`[AUDIT2-02-002]` Generic signals reject scalar string cache keys in `matchesInvalidateSignalKey`**
  - **Decision:** `fix-now` (`done`)
  - **Resolution:** Clarified scalar string cache key evaluation behavior for `GenericInvalidateSignal` in `spec/sse-query-invalidate-contract.md`.
  - **Batch:** [`batch_02_types-and-tests.md`](./batch_02_types-and-tests.md#audit2-02-002-generic-signals-reject-scalar-string-cache-keys-in-matchesinvalidatesignalkey)

- **`[AUDIT2-03-001]` Verified agreement on `SSEChannelGroup` and transport adapters channel management**
  - **Decision:** `verified-no-fix-needed` (`done`)
  - **Resolution:** Verified channel management, Fastify `reply.hijack()` auto-invocation, and Last-Event-ID length caps across spec, docs, and implementation.
  - **Batch:** [`batch_03_agreed-components.md`](./batch_03_agreed-components.md#audit2-03-001-verified-agreement-on-ssechannelgroup-and-transport-adapters-channel-management)

- **`[AUDIT2-04-001]` Verified agreement across Client SSE core and framework adapters**
  - **Decision:** `verified-no-fix-needed` (`done`)
  - **Resolution:** Verified client reconnection backoff, terminal revocation handling, React unmount cleanup, SWR, and TanStack Query adapters.
  - **Batch:** [`batch_03_agreed-components.md`](./batch_03_agreed-components.md#audit2-04-001-verified-agreement-across-client-sse-core-and-framework-adapters)

- **`[AUDIT2-05-001]` Verified agreement on PubSub encryption contract and self-echo suppression**
  - **Decision:** `verified-no-fix-needed` (`done`)
  - **Resolution:** Verified AES-256-GCM cipher with topic AAD binding and adapter self-echo suppression across core, Ably, Pusher, and Redis adapters.
  - **Batch:** [`batch_03_agreed-components.md`](./batch_03_agreed-components.md#audit2-05-001-verified-agreement-on-pubsub-encryption-contract-and-self-echo-suppression)

- **`[AUDIT2-06-001]` Verified agreement on build scripts and example runners**
  - **Decision:** `verified-no-fix-needed` (`done`)
  - **Resolution:** Verified 15-entrypoint smoke test script and multi-stack example runner mappings.
  - **Batch:** [`batch_03_agreed-components.md`](./batch_03_agreed-components.md#audit2-06-001-verified-agreement-on-build-scripts-and-example-runners)

---

## Items Needing Human Decision

None. All findings were unambiguous and resolved directly.

---

## New Findings Surfaced During Fixing

None.
