# Documentation Discrepancies Log

This file records all identified discrepancies, contradictions, and ambiguities between prior documentation/README content and the authoritative TypeScript implementation, test suite, and export maps of `restale-kit`.

---

## 1. `SIGNAL_TARGETS` Constant Property Naming

- **File:** `docs/api-reference.md`, `README.md`, `docs/signals.md`
- **Claim:** Documentation previously used `SIGNAL_TARGETS.TANSTACK` or inconsistent property names for target discriminators.
- **Reality:** In `restale-kit/src/utils/constants.ts`, the exported `SIGNAL_TARGETS` object is defined as:
  ```ts
  export const SIGNAL_TARGETS = {
    TANSTACK_QUERY: 'tanstack-query',
    SWR: 'swr',
    RTK: 'rtk-query',
    GENERIC: 'generic',
  } as const
  ```
  The property names are `TANSTACK_QUERY`, `SWR`, `RTK`, and `GENERIC`.
- **Action taken:** Resolved all documentation references to use `SIGNAL_TARGETS.TANSTACK_QUERY`, `SIGNAL_TARGETS.SWR`, `SIGNAL_TARGETS.RTK`, and `SIGNAL_TARGETS.GENERIC`.

---

## 2. TanStack Query Signal Key Field in Getting Started

- **File:** `docs/getting-started.md`
- **Claim:** Summary text claimed `group.broadcastToAll({ key: ['todos'] })`.
- **Reality:** In `TanStackQuerySignal` (`src/types/protocol.ts`), the query identifier field is `queryKey: JSONValue[]`, whereas `key` is used by `SWRSignal` and `GenericInvalidateSignal`.
- **Action taken:** Corrected `getting-started.md` prose to `group.broadcastToAll({ queryKey: ['todos'] })`.

---

## 3. `useReStale` Options and Return Value Structure

- **File:** `docs/client.md`
- **Claim:** `onInvalidate` was documented as a generic callback `(signal: InvalidateSignal | InvalidateSignal[]) => void` and return value omitted connection state helper flags.
- **Reality:** `useReStale` expects `AdaptedInvalidateCallback<TTarget, TSignal>` (produced by `useTanstackQueryAdapter` or `useSwrAdapter`) to automatically infer `target` and enforce type safety. Its return value includes `connectionId`, `connection`, `attempt`, `isConnecting`, `isConnected`, `isReconnecting`, `isClosed`, `isError`, `reconnect`, and `close`.
- **Action taken:** Updated `client.md` and `api-reference.md` to document the exact `UseReStaleOptions` and `UseReStaleResult` types.

---

## 4. `SWRSignal` Payload Field Claims

- **File:** `docs/validation.md`
- **Claim:** Documented `optimisticData` as an optional field on `SWRSignal`.
- **Reality:** `SWRSignal` in `src/types/protocol.ts` consists of `target`, `key`, `action`, `revalidate`, `match`. It does not contain an `optimisticData` field in the protocol.
- **Action taken:** Removed all mentions of `optimisticData` from `validation.md` and `signals.md`.

---

## 5. Export Subpath Mappings in API Reference

- **File:** `docs/api-reference.md`, `docs/README.md`
- **Claim:** `docs/README.md` claimed `restale-kit/testing` was for `createSSEChannel` (test utility only), and listed an incomplete set of subpath exports.
- **Reality:** `package.json` specifies 12 entry points in `exports`:
  `.`, `./server`, `./testing`, `./client`, `./react`, `./swr`, `./tanstack-query`, `./rtk-query`, `./pubsub`, `./redis`, `./ably`, `./pusher`.
- **Action taken:** Updated `api-reference.md` and `docs/README.md` to document all 12 package subpaths matching `package.json` exactly.

---

## 6. Default Reconnect Backoff Values

- **File:** `docs/client.md`
- **Claim:** Default `baseDelayMs` was listed as `1_000` ms and `maxDelayMs` as `30_000` ms.
- **Reality:** In `src/client/core/backoff.ts`, `DEFAULT_BASE_DELAY_MS = 1000`, `DEFAULT_MAX_DELAY_MS = 30000`, `jitter = true`, `maxRetries = Infinity` (`PROTOCOL_CONSTANTS.DEFAULT_MAX_RETRIES`).
- **Action taken:** Verified and documented exact numbers across `client.md` and `api-reference.md`.

---

## 7. Default Keepalive Interval

- **File:** `docs/server.md`
- **Claim:** Keepalive interval default was ambiguously described.
- **Reality:** In `src/utils/constants.ts`, `DEFAULT_KEEPALIVE_INTERVAL_MS = 0` (keepalive comments are disabled by default).
- **Action taken:** Explicitly documented default `0` (disabled).

---

## 8. Granular `autoReconnect` Option Structure

- **File:** `docs/client.md`
- **Claim:** `autoReconnect` was documented strictly as a boolean.
- **Reality:** `ClientOptions` supports `autoReconnect?: boolean | AutoReconnectOptions`, where `AutoReconnectOptions` is `{ native?: boolean; jsBackoff?: boolean }`.
- **Action taken:** Fully documented `AutoReconnectOptions` union in `client.md` and `api-reference.md`.

---

## 9. Fastify `reply.hijack()` Handshake Handling

- **File:** `docs/server.md`, `docs/troubleshooting.md`
- **Claim:** Unclear guidance on whether consumers using Fastify must invoke `reply.hijack()`.
- **Reality:** `group.attachNodeResponse` checks for Fastify reply objects and executes `reply.hijack()` automatically. Calling `reply.hijack()` manually before passing `reply` can cause double-hijack or response header state issues in certain Fastify versions.
- **Action taken:** Clarified automatic hijacking in `server.md` and added a resolution note in `troubleshooting.md`.

---

## 10. RTK Query Signal Discriminator and Adapter Export

- **File:** `docs/api-reference.md`, `docs/signals.md`, `docs/client.md`
- **Claim:** RTK Query signal shape and adapter subpath were omitted from dedicated signal and client documentation.
- **Reality:** `restale-kit/rtk-query` exports `rtkQueryAdapter` and `useRtkQueryAdapter` targeting `SIGNAL_TARGETS.RTK` (`'rtk-query'`) with `RTKQuerySignal` shape `{ target?: 'rtk-query', tags: Array<string | { type: string; id?: string | number }> }`.
- **Action taken:** Added comprehensive documentation for `RTKQuerySignal` in `signals.md`, `client.md`, and `api-reference.md`.
