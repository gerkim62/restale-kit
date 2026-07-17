# Audit 3 Shard 02: Types, Protocol Schemas, Errors, Utilities, Export Contracts

## Reviewed Sources
- `restale-kit/src/types/errors.ts`
- `restale-kit/src/types/index.ts`
- `restale-kit/src/types/protocol.ts`
- `restale-kit/src/types/protocol.test.ts`
- `restale-kit/src/types/standard-schema.ts`
- `restale-kit/src/types/standard-schema.test.ts`
- `restale-kit/src/utils/constants.ts`
- `restale-kit/src/utils/id.ts`
- `restale-kit/src/utils/id.test.ts`
- `restale-kit/src/utils/url.ts`
- `restale-kit/src/utils/url.test.ts`
- `restale-kit/src/index-exports.test.ts`

---

### [AUDIT3-02-01] `matchesInvalidateSignalKey` always returns `false` for `RTKQuerySignal`
- **Area:** `restale-kit/src/types/protocol.ts:94-131` vs `restale-kit/src/types/protocol.test.ts`
- **Type:** undocumented-behavior / wrong-test
- **Evidence:**
  - `restale-kit/src/types/protocol.ts:94-131`:
    `matchesInvalidateSignalKey` explicitly handles `signal.target === SIGNAL_TARGETS.TANSTACK` (checking `queryKey`), `signal.target === SIGNAL_TARGETS.SWR` (checking `key`), and generic signals (checking `'key' in signal`). For `RTKQuerySignal` (`target: 'rtk-query'`, `tags: [...]`), none of these branches match and it returns `false`.
  - `restale-kit/src/types/protocol.test.ts`:
    No test cases exist for passing an `RTKQuerySignal` to `matchesInvalidateSignalKey`.
- **Discrepancy:** `RTKQuerySignal` is part of the `ReStaleSignal` union accepted by `matchesInvalidateSignalKey`, but signal key matching for RTK tag structures is unimplemented and returns `false`.
- **Which source is correct / should be trusted:** Returning `false` for tag-based invalidations is correct since RTK Query tag matching relies on tag types/IDs rather than hierarchical JSON keys, but it is untested and undocumented.
- **Recommended fix:** Add a test case in `protocol.test.ts` confirming `matchesInvalidateSignalKey` returns `false` for `RTKQuerySignal`, or document that RTK Query signals require custom tag handling.
- **Severity:** low
- **Confidence:** high

---

### [AUDIT3-02-02] Incomplete coverage in `index-exports.test.ts` for all entrypoints
- **Area:** `restale-kit/src/index-exports.test.ts` vs `restale-kit/package.json`
- **Type:** missing-test
- **Evidence:**
  - `restale-kit/package.json`: Defines subpath exports `./pubsub`, `./redis`, `./ably`, `./pusher`.
  - `restale-kit/src/index-exports.test.ts`: Only tests exports from `./client/*`, `./server/*`, and `./types/index.js`. Does not import or test `./pubsub/core/index.js`, `./pubsub/redis/index.js`, `./pubsub/ably/index.js`, or `./pubsub/pusher/index.js`.
- **Discrepancy:** Entrypoint export verification tests do not cover the pub/sub subpath exports.
- **Which source is correct / should be trusted:** `package.json` subpath exports are authoritative.
- **Recommended fix:** Extend `index-exports.test.ts` to assert defined status of `redisPubSubAdapter`, `ablyPubSubAdapter`, `pusherPubSubAdapter`, and `PubSubDecryptionError`.
- **Severity:** low
- **Confidence:** high
