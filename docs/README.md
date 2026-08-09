# restale-kit Documentation

`restale-kit` pushes server-side cache-invalidation signals to connected client applications over Server-Sent Events (SSE), enabling TanStack Query, SWR, RTK Query, and custom client stores to automatically refetch stale data without websockets or polling.

---

## Documentation Index

| File | Summary |
|---|---|
| [getting-started.md](./getting-started.md) | Fastest path to a working Express + TanStack Query integration in under 10 minutes |
| [concepts.md](./concepts.md) | SSE lifecycle mental model, key architectural decisions, and terminology glossary |
| [server.md](./server.md) | `SSEChannelGroup` setup, framework adapters, broadcasting methods, and connection revocation |
| [client.md](./client.md) | `useReStale` React hook, `SSEInvalidatorClient`, framework adapters, and connection status |
| [signals.md](./signals.md) | `InvalidateSignal` discriminated union shapes, key matching semantics, and `SIGNAL_TARGETS` |
| [pubsub.md](./pubsub.md) | Horizontal scaling across multiple server instances with Redis, Ably, Pusher, and payload encryption |
| [validation.md](./validation.md) | Built-in structural wire validation and custom metadata validation using `metaSchema` |
| [security.md](./security.md) | Recommended HTTP-only cookie authentication, `connectionId` correlation caveats, and CORS configuration |
| [api-reference.md](./api-reference.md) | Exhaustive TypeScript signatures for all 12 package subpaths |
| [examples.md](./examples.md) | Annotated, copy-paste runnable server and client integration examples |
| [troubleshooting.md](./troubleshooting.md) | Common error codes, causes, and step-by-step resolution paths |
| [changelog.md](./changelog.md) | Complete version history and release notes |
| [DISCREPANCIES.md](./DISCREPANCIES.md) | Audit record of discrepancies between past documentation and source implementation |
