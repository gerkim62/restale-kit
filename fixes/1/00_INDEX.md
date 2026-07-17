# Fixes Index (Session 1)

## Rationale
Work is organized into fix-batches ordered by severity and domain:
1. `batch_01_high_severity.md`: High severity discrepancies affecting core specs (`spec/sse-query-invalidate-contract.md` and `spec/pubsub-adapter-contract.md`).
2. `batch_02_medium_specs_and_docs.md`: Medium severity discrepancies in protocol specs, client adapters, server core replay semantics, and test plans.
3. `batch_03_low_specs_and_docs.md`: Low severity spec and documentation clarifications (security constraints, key matching rules, subpath exports).
4. `batch_04_low_examples_and_meta.md`: Low severity example applications and repository meta-spec drift (`CHANGELOG.md`, `folder-structure.md`).

## Fix-Batch Plan

| Batch File | Scope / Source Shards | Status |
| --- | --- | --- |
| `fixes/1/batch_01_high_severity.md` | [DISC-01-01], [DISC-04-01] (Shards 01, 04) | done |
| `fixes/1/batch_02_medium_specs_and_docs.md` | [DISC-01-02], [DISC-02-01], [DISC-02-02], [DISC-03-01], [DISC-03-02], [DISC-03-03], [DISC-07-01] (Shards 01, 02, 03, 07) | done |
| `fixes/1/batch_03_low_specs_and_docs.md` | [DISC-01-03], [DISC-02-03], [DISC-04-02], [DISC-05-01], [DISC-05-02], [DISC-05-03] (Shards 01, 02, 04, 05) | done |
| `fixes/1/batch_04_low_examples_and_meta.md` | [DISC-06-01], [DISC-06-02], [DISC-07-02], [DISC-07-03] (Shards 06, 07) | done |


