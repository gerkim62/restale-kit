# Documentation/Implementation Alignment Plan

## Goal

Resolve the 20 findings in `DOCUMENTATION_AUDIT_REPORT.md` and the 9 follow-up
findings identified on 2026-08-14. The implementation is the source of truth
unless a documented public type is itself unusable; in that case, make the
smallest compatible implementation/export correction required for the
documentation to be truthful.

## Work items

- [x] 1. Reconcile the original 20 findings against the current tree and mark
  already-resolved findings with evidence.
- [x] 2. Repair core, server, client, React, testing, TanStack, SWR, and RTK
  sections of `docs/api-reference.md` so imports, types, signatures, and
  exported members match the package barrels.
- [x] 3. Repair the narrative docs (`docs/getting-started.md`, `docs/server.md`,
  `docs/client.md`, `docs/validation.md`, `docs/pubsub.md`) and ensure their
  runnable examples use valid signal shapes and lifecycle contracts.
- [x] 4. Repair both published-facing READMEs, including the vanilla custom
  handler, signal types, custom-signal example, reconnect/rejection options,
  status variants, and event-ID behavior.
- [x] 5. Make minimal public-barrel or implementation changes only where the
  documentation needs a supported, importable contract (for example React type
  re-exports), and add/regress focused tests as appropriate.
- [x] 6. Verify all 29 items using targeted searches, TypeScript typecheck,
  tests, build, and package verification; update this plan with the results.

## Finding tracker

| Findings | Area | Status | Evidence |
|---|---|---|---|
| Original 1-12 | Core and API reference | Resolved | Wire framing target preservation documented; `SIGNAL_TARGETS.TANSTACK_QUERY` fixed; clientContext removed; `SSEInvalidatorClientEventMap` / `ConnectionStatus` / `RejectedConnectionResponse` / `RenewEventDetail` / `AdaptedInvalidateCallback` documented; `AutoReconnectOptions` exported; `useReStale` options/result aligned; `QueryClientLike` and `RTKQueryApiLike` documented; `createSSEChannel` / `SSEChannel` server exports defined; optional `target?:` in base signal types. |
| Original 13-20 | Guides and examples | Resolved | `getting-started.md` uses `{ queryKey: ['todos'] }`; `validation.md` removed `optimisticData` and uses `queryKey`; `pubsub.md` registers trusted `userId`/`sessionId` metadata; `client.md` options/results blocks complete; `client.md` vanilla client includes `rejected` and `retriesexhausted` listeners. |
| Follow-up 1-9 | Root/package READMEs and remaining API-reference issues | Resolved | (1) Root README Option B discriminates `key`/`queryKey`/`tags` safely on signals/batches; (2) `target?:` is optional across native signal interfaces and table clarifies group defaults; (3) `AppSignal` custom example fixed with typed `useTanstackQueryAdapter<AppSignal>` and `useReStale<'tanstack-query', AppSignal>`; (4) `useReStale` documents `AdaptedInvalidateCallback<TTarget, TSignal>`; (5) `restale-kit/react` re-exports `RevokeEventDetail`, `RenewEventDetail`, `RejectedConnectionResponse`, `AdaptedInvalidateCallback`; (6) SWR adapter signatures use `TSignal extends SWRSignal` and return `AdaptedInvalidateCallback<'swr', TSignal>`; (7) `SSEInvalidatorClient.attempt` getter documented in API ref and client guide; (8) package README documents `onRejected`, `onRetriesExhausted`, `nonRetryableStatuses`, `retryAfter`, and `'rejected'` status; (9) package README table clarifies `idGenerator` and `EventStore` auto-incrementing vs empty string default. |

## Acceptance criteria

- [x] Every documented import resolves from the stated entry point.
- [x] Every example uses a valid signal shape for its configured target and safely
  handles batches where the API permits them.
- [x] Published documentation represents the exported options, events, states, and
  adapter return types accurately.
- [x] `pnpm --filter restale-kit run typecheck`, tests, build, and package
  verification pass.
