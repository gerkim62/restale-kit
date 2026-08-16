# Regression Test Suite

This document outlines the regression test suite located in `src/__tests__/regression/` that validates wire protocol behavior, framing, runtime validation, and adapter parity:

- **`wire-roundtrip.test.ts`**: Verifies that server-encoded SSE frames (`invalidate`, `revoke`, `renew`) correctly decode, handle multiline JSON data splitting, and parse through `MockEventSource` into deep-equal objects on client event listeners.
- **`batch-signals.test.ts`**: Proves that invalid signal batches are rejected atomically without partial acceptance and that multi-signal batches serialize to a single SSE wire frame and record as a single `EventRecord` in the `EventStore`.
- **`signal-shape-validation.test.ts`**: Asserts complete accept/reject agreement between client `validatePayload` and server `validateSignalPayload` across valid signals, mixed arms, invalid types, and prototype pollution guards.
- **`frame-guard.test.ts`**: Tests that `beforeFrame` intercepts real `UniversalSignal` payloads for signal frames, receives undefined signal on keepalive ticks, skips `EventStore` persistence when returning `skip`, and enqueues revoke frames on `close`.
- **`adapter-parity.test.ts`**: Validates behavioral parity between `tanstackQueryAdapter` and `swrAdapter` when processing identical universal signal batches containing exact revalidations, prefix revalidations, and inline data writes with follow-up `markStale` invalidations.
- **`pubsub-envelope-roundtrip.test.ts`**: Tests full publish-to-subscribe round trips for Redis, Ably, and Pusher pub/sub adapters under both plaintext and AES-GCM encrypted envelope configurations, ensuring decrypted signals deep-equal original payloads.
