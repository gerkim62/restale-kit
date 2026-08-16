# restale-kit — Documentation

`restale-kit` lets your server push cache-invalidation signals to connected clients over **SSE**, so TanStack Query, SWR, or any custom cache automatically refetches when your data changes.

---

## Guides

| Guide | What it covers |
|---|---|
| [Getting Started](./getting-started.md) | Install, minimal server + client wiring in 5 minutes |
| [Server](./server.md) | All server adapters, `SSEChannelGroup`, broadcasting, topics |
| [Next.js & Serverless](./nextjs.md) | Singleton lifecycle patterns, HMR safety, App Router setup, and troubleshooting |
| [Client](./client.md) | `useReStale` hook, vanilla JS client, and TanStack Query, SWR & RTK Query adapters |
| [Client Context & Inline Data](./inline-data.md) | Per-connection query context and direct cache writes without an intermediate refetch |
| [Validation](./validation.md) | Built-in signal validation and optional Zod / Standard Schema metadata validation |
| [Pub/Sub](./pubsub.md) | Scaling across multiple instances with Redis, Ably, or Pusher |
| [API Reference](./api-reference.md) | Every export, every type signature, in one place |

---

## Quick orientation

```text
restale-kit/server         → SSEChannelGroup, createSSEChannel, createEventStore
restale-kit/testing        → createSSEChannel (standalone direct channel helper)
restale-kit/client         → SSEInvalidatorClient  (vanilla JS)
restale-kit/react          → useReStale  (React hook)
restale-kit/tanstack-query → tanstackQueryAdapter
restale-kit/swr            → swrAdapter
restale-kit/rtk-query      → rtkQueryAdapter
restale-kit/pubsub         → PubSubAdapter
restale-kit/redis          → redisPubSubAdapter
restale-kit/ably           → ablyPubSubAdapter
restale-kit/pusher         → pusherPubSubAdapter
```
