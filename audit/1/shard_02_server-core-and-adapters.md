# Audit Shard 02: Server Core & Framework Adapters

## Scope
- Spec: `spec/sse-query-invalidate-contract.md` (Sections: Server side, Multi-channel broadcasting)
- Docs: `docs/server.md`, `docs/api-reference.md`, `README.md`, `restale-kit/README.md`
- Code:
  - `restale-kit/src/server/core/channel.ts`
  - `restale-kit/src/server/core/channel-group.ts`
  - `restale-kit/src/server/core/event-store.ts`
  - `restale-kit/src/server/core/framing.ts`
  - `restale-kit/src/server/node/attach.ts`
  - `restale-kit/src/server/fetch/response.ts`
  - `restale-kit/src/server/fastify/index.ts`
  - `restale-kit/src/server/express/index.ts`
  - `restale-kit/src/server/hono/index.ts`
  - `restale-kit/src/server/transport-utils.ts`
- Tests:
  - `restale-kit/src/server/core/channel.test.ts`
  - `restale-kit/src/server/core/channel-group.test.ts`
  - `restale-kit/src/server/core/event-store.test.ts`
  - `restale-kit/src/server/core/framing.test.ts`
  - `restale-kit/src/server/express/index.test.ts`
  - `restale-kit/src/server/fastify/index.test.ts`
  - `restale-kit/src/server/hono/index.test.ts`
  - `restale-kit/src/server/node/attach.test.ts`
  - `restale-kit/src/server/fetch/response.test.ts`
  - `restale-kit/src/server/e2e-transport.test.ts`

---

## Discrepancies

### [DISC-02-01] `SSEChannel.revoke(reason)` missing from Spec interface definition
- **Area:** `spec/sse-query-invalidate-contract.md:L228-L236`, `docs/api-reference.md:L94-L99`, `restale-kit/src/server/core/channel.ts:L82-L82`
- **Type:** spec-not-implemented
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md:L228-L236`:
    ```ts
    interface SSEChannel<TSignal extends InvalidateSignal = InvalidateSignal> {
      readonly state: ChannelState
      readonly stream: ReadableStream<Uint8Array>
      readonly connectionId: string
      invalidate(signal: TSignal | TSignal[], customId?: string): string
      close(): void
      disconnect(): void   // called by a transport adapter when it detects the peer disconnected
      onClose(callback: () => void): void
    }
    ```
  - `docs/api-reference.md:L94-L99`:
    ```ts
    revoke(reason?: string): void                       // default reason: 'revoked'
    ```
  - `restale-kit/src/server/core/channel.ts:L82-L82`:
    ```ts
    revoke(reason: string = 'revoked'): void { ... }
    ```
- **Discrepancy:** The specification interface for `SSEChannel` in `spec/sse-query-invalidate-contract.md` does not list the `revoke(reason?: string)` method. Both implementation and `docs/api-reference.md` contain `revoke`.
- **Which source is correct / should be trusted:** Implementation (`channel.ts`). `revoke()` is critical for sending terminal `event: revoke` frames before closing stream connections.
- **Recommended fix:** Update `spec/sse-query-invalidate-contract.md` to include `revoke(reason?: string): void` in `interface SSEChannel`.
- **Severity:** medium
- **Confidence:** high

### [DISC-02-02] `eventBufferCapacity` set on `SSEChannelGroup` does not automatically attach event store to registered channels
- **Area:** `spec/sse-query-invalidate-contract.md:L265-L274`, `restale-kit/src/server/core/channel-group.ts:L186-L190`, `restale-kit/src/server/core/channel.ts:L108-L116`
- **Type:** implementation-drift
- **Evidence:**
  - `spec/sse-query-invalidate-contract.md:L265-L267`:
    `When eventStore is provided (or eventBufferCapacity > 0 is set, which auto-creates one), every invalidate() call records the signal in the store with a unique event ID.`
  - `restale-kit/src/server/core/channel-group.ts:L186-L190`:
    ```ts
    if (options?.eventStore) {
      this.eventStore = options.eventStore
    } else if (options?.eventBufferCapacity !== undefined && options.eventBufferCapacity > 0) {
      this.eventStore = createEventStore<TSignal>({ capacity: options.eventBufferCapacity })
    }
    ```
  - `restale-kit/src/server/core/channel-group.ts:L334-L350`:
    `group.register(channel, meta)` accepts a pre-constructed `channel`. `group.register` does not pass `this.eventStore` onto `channel`. If a channel was created via `attachSSE(req, res)` without passing `{ eventStore: group.eventStore }`, `channel` does not have an `eventStore` attached, meaning direct `channel.invalidate()` calls or reconnects handled by that channel won't use the group's event store.
- **Discrepancy:** The spec implies setting `eventBufferCapacity` or `eventStore` on the group or channel auto-enables event ID assignment. However, in code, unless `{ eventStore }` is explicitly passed into `attachSSE(req, res, { eventStore })` when creating the channel, reconnecting channels won't replay missed events from the group's store.
- **Which source is correct / should be trusted:** Implementation behavior requires explicit `eventStore` sharing between transport adapters and `SSEChannelGroup` as documented in `docs/server.md:L292-L304`. The spec should clarify this requirement.
- **Recommended fix:** Update `spec/sse-query-invalidate-contract.md` to note that `eventStore` must be passed to both `SSEChannelGroup` and transport options (`attachSSE`/`toSSEResponse`) for reconnection replay to function.
- **Severity:** medium
- **Confidence:** high

### [DISC-02-03] `broadcastByKey` auto-wraps scalar and object metadata into arrays for key matching without spec documentation
- **Area:** `spec/sse-query-invalidate-contract.md:L398-L399`, `docs/server.md:L210-L214`, `restale-kit/src/server/core/channel-group.ts:L646-L651`
- **Type:** undocumented-behavior
- **Evidence:**
  - `restale-kit/src/server/core/channel-group.ts:L646-L651`:
    ```ts
    this.broadcast(signal, (meta) => {
      if (!isJSONValue(meta)) return false
      const metaKey = Array.isArray(meta) ? meta : [meta]
      return matchesInvalidateSignalKey(metaKey, signal)
    })
    ```
  - `spec/sse-query-invalidate-contract.md:L398-L399`:
    `Broadcasts to channels whose metadata matches the signal's key using the same hierarchical prefix/exact matching semantics as the wire protocol.`
- **Discrepancy:** The spec does not explain that non-array metadata (e.g. `{ userId: '123' }`) is automatically wrapped into a single-element array `[{ userId: '123' }]` during `broadcastByKey` evaluation. `docs/server.md` documents this, but the spec does not.
- **Which source is correct / should be trusted:** Implementation and `docs/server.md`.
- **Recommended fix:** Update `spec/sse-query-invalidate-contract.md` to document scalar/object metadata wrapping in `broadcastByKey`.
- **Severity:** low
- **Confidence:** high

---

## Verified Correct Behavior (Agreements)
- SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`) match across all transport adapters (`attachSSE`, `toSSEResponse`), specs, docs, and tests (`e2e-transport.test.ts`).
- `__restale_cid__` query parameter extraction and validation are enforced synchronously at the route boundary across Node, Express, Fastify, Hono, and Fetch adapters.
- Fastify adapter (`attachSSE`) automatically invokes `reply.hijack()` when passed Fastify request/reply objects.
- Disconnect handling (`req.on('close')` in Node/Express/Fastify, `request.signal.addEventListener('abort')` in Fetch/Hono) correctly triggers `channel.disconnect()` and automatic deregistration in `SSEChannelGroup`.
- SSE frame formatting (`formatInvalidateFrame`, `formatKeepalive`, `formatRevokeFrame`) adheres strictly to spec formatting rules (including multi-line JSON splitting, carriage return sanitization in IDs, and comment prefix for keepalives).
