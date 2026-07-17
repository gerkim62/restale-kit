# Fix Verification Index (Session 1)

## Fix Check Plan

| Check File | Source Fix Batch | Scope / Description | Status |
| --- | --- | --- | --- |
| `checks/1/check_batch_01_high_severity.md` | `fixes/1/batch_01_high_severity.md` | Re-verification of high severity fixes (wire signal discriminated union, PubSub encryption spec) | done |
| `checks/1/check_batch_02_medium_specs_and_docs.md` | `fixes/1/batch_02_medium_specs_and_docs.md` | Re-verification of medium severity fixes (API utility exports, SSEChannel.revoke, eventStore sharing, TanStack/SWR adapters, revocation status, vitest plan) | done |
| `checks/1/check_batch_03_low_specs_and_docs.md` | `fixes/1/batch_03_low_specs_and_docs.md` | Re-verification of low severity spec & doc fixes (scalar key matching, non-array metadata wrapping, PubSub errors, 512-byte header limit, controlTopic validation, draft spec rename) | done |
| `checks/1/check_batch_04_low_examples_and_meta.md` | `fixes/1/batch_04_low_examples_and_meta.md` | Re-verification of example app & meta fixes (Vercel Redis cleanup, Fastify predicate typing, CHANGELOG v0.2.0, folder structure diagram) | done |
