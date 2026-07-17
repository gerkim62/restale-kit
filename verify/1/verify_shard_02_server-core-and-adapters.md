# Verification Shard 02: Server Core & Framework Adapters

## Findings Re-Verification

### [DISC-02-01] `SSEChannel.revoke(reason)` missing from Spec interface definition
- **Audit claim:** Spec interface for `SSEChannel` omitted `revoke(reason?: string): void`, which existed in `channel.ts` and `api-reference.md`.
- **Re-checked evidence:**
  - `restale-kit/src/server/core/channel.ts:L82`: `revoke(reason: string = 'revoked'): void` implemented.
  - `spec/sse-query-invalidate-contract.md:L228-L236`: Interface omitted `revoke`.
- **Verdict:** confirmed
- **Reasoning:** Spec interface was missing a public method present in implementation and API reference.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-02-02] `eventBufferCapacity` set on `SSEChannelGroup` does not automatically attach event store to registered channels
- **Audit claim:** Spec implied setting `eventBufferCapacity` auto-enables event ID assignment, but `group.register` does not attach `this.eventStore` to channels unless passed to transport adapters.
- **Re-checked evidence:**
  - `restale-kit/src/server/core/channel-group.ts:L334-L350`: `group.register(channel, meta)` does not mutate `channel.eventStore`.
  - `docs/server.md:L292-L304`: Explains `eventStore` sharing requirement.
- **Verdict:** confirmed
- **Reasoning:** Spec wording was misleading regarding automated event store propagation.
- **Correction (if any):** None.
- **Confidence:** high

### [DISC-02-03] `broadcastByKey` auto-wraps scalar and object metadata into arrays for key matching without spec documentation
- **Audit claim:** `broadcastByKey` wraps scalar or object metadata into `[meta]` when invoking `matchesInvalidateSignalKey`.
- **Re-checked evidence:**
  - `restale-kit/src/server/core/channel-group.ts:L646-L651`: `const metaKey = Array.isArray(meta) ? meta : [meta]`.
- **Verdict:** confirmed
- **Reasoning:** Implemented behavior in code and documented in `docs/server.md`, but missing in spec.
- **Correction (if any):** None.
- **Confidence:** high
