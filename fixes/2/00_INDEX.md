# Fixes 2 Index

## Grouping Rationale

Fixes are grouped to mirror the audit shards logically while separating documentation/spec updates (`batch_01_spec-and-docs.md`), code and test enhancements (`batch_02_types-and-tests.md`), and pre-verified non-discrepancy audit confirmations (`batch_03_agreed-components.md`).

## Fix Batches

| Batch File | Description | Source Shards | Status |
| --- | --- | --- | --- |
| `batch_01_spec-and-docs.md` | Fix StandardSchemaV1 spec claims, schema type naming in docs, and protocol utility export lists | `shard_01_spec-and-docs.md` | done |
| `batch_02_types-and-tests.md` | Add missing export test assertions and clarify generic signal scalar key behavior | `shard_02_types-protocol-utils.md` | done |
| `batch_03_agreed-components.md` | Record triage & verification for server, client, pubsub, and scripts agreement findings | `shard_03_...`, `shard_04_...`, `shard_05_...`, `shard_06_...` | done |
