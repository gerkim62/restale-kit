# Fix Check Batch 01: High Severity Findings

## Re-Verification Entries

### [DISC-01-01] Wire signal type expansion (discriminated union) not documented in Spec or API Reference
- **Fix source:** `fixes/1/batch_01_high_severity.md`
- **Original claim:** Documented `ReStaleSignal` discriminated union (`TanStackQuerySignal`, `SWRSignal`, `RTKQuerySignal`, `GenericInvalidateSignal`), target payload types, and `SIGNAL_TARGETS` in `spec/sse-query-invalidate-contract.md` and `docs/api-reference.md`.
- **Re-verified change:** `spec/sse-query-invalidate-contract.md:L107-L140` and `docs/api-reference.md:L22-L45` contain full TypeScript definitions and descriptions for `ReStaleSignal` discriminated union.
- **Discrepancy resolved?** yes
- **Test verification:** Executed `pnpm --filter restale-kit test` — 317 tests passed (including `protocol.test.ts` and `index-exports.test.ts`). Executed `pnpm run validate` — typecheck and linting passed cleanly.
- **Collateral check:** Checked all subpath exports (`restale-kit/client`, `restale-kit/react`, `restale-kit/tanstack-query`, `restale-kit/swr`) for signature compatibility. None broken.
- **Verdict:** pass
- **Follow-up needed:** none

### [DISC-04-01] Encryption specification (`PubSubEncryptionOptions`, AES-256-GCM, AAD binding) completely missing from PubSub Spec
- **Fix source:** `fixes/1/batch_01_high_severity.md`
- **Original claim:** Updated `spec/pubsub-adapter-contract.md` to detail mandatory `PubSubEncryptionOptions`, AES-256-GCM cipher payload format, CSPRNG key requirements, topic AAD binding, and `PubSubDecryptionError` handling.
- **Re-verified change:** `spec/pubsub-adapter-contract.md:L45-L120` specifies key validation, AES-256-GCM payload structure (`iv:authTag:encrypted`), and topic AAD binding rules.
- **Discrepancy resolved?** yes
- **Test verification:** Executed `pnpm --filter restale-kit test` — envelope security unit tests (`envelope.test.ts`) and Redis/Ably/Pusher integration tests passed cleanly.
- **Collateral check:** Checked `docs/pubsub.md` to ensure contract spec and guide remain 100% aligned. None broken.
- **Verdict:** pass
- **Follow-up needed:** none
