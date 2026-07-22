# restale-kit — Documentation

`restale-kit` lets your server push cache-invalidation signals to connected clients over **SSE**, so TanStack Query, SWR, or any custom cache automatically refetches when your data changes.

---

## Guides

| Guide | What it covers |
|---|---|
| [Getting Started](./getting-started.md) | Install, minimal server + client wiring in 5 minutes |
| [Server](./server.md) | All server adapters, `SSEChannelGroup`, broadcasting, topics |
| [Client](./client.md) | `useReStale` hook, vanilla JS client, TanStack Query & SWR adapters |
| [Validation](./validation.md) | Optional Zod / Standard Schema runtime validation |
| [Pub/Sub](./pubsub.md) | Scaling across multiple instances with Redis, Ably, or Pusher |
| [API Reference](./api-reference.md) | Every export, every type signature, in one place |

---

## Quick orientation

```text
restale-kit/server         → SSEChannelGroup, createEventStore
restale-kit/testing        → createSSEChannel (test utility only)
restale-kit/client         → SSEInvalidatorClient  (vanilla JS)
restale-kit/react          → useReStale  (React hook)
restale-kit/tanstack-query → tanstackQueryAdapter
restale-kit/swr            → swrAdapter
restale-kit/redis          → redisPubSubAdapter
restale-kit/ably           → ablyPubSubAdapter
restale-kit/pusher         → pusherPubSubAdapter
```

> **Spec / design documents** live in [`spec/`](../spec/README.md) — useful for understanding the wire protocol and architectural decisions, not required for day-to-day usage.
