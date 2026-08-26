# ReStale Kit Documentation

Zero-gap documentation and recipes for `restale-kit` — the minimal library to invalidate client-side queries via Server-Sent Events (SSE).

---

## 📖 Guides

- [**Getting Started**](./guide/getting-started.md) — 5-minute setup, installation, and first invalidation
- [**Core Concepts**](./guide/concepts.md) — Channels, groups, topics, signals vs. inline data
- [**Security Model**](./guide/security-model.md) — `secret`, `scopeBy`, HMAC token format, and threat model
- [**Schema Validation**](./guide/validation.md) — Standard Schema integration for metadata and client context
- [**Inline Data Resolution**](./guide/inline-data.md) — Direct query cache writes over SSE
- [**Distributed Pub/Sub**](./guide/pubsub.md) — Redis, Ably, Pusher scaling across multi-pod clusters
- [**Next.js & Serverless**](./guide/nextjs.md) — App Router Route Handlers, HMR singletons, and edge runtimes

---

## 🍳 Framework Recipes

### Server Transports
- [Express 5.x](./recipes/server-express.md)
- [Fastify 5.x](./recipes/server-fastify.md)
- [Hono](./recipes/server-hono.md)
- [Native Node.js `http`](./recipes/server-node.md)
- [Web Fetch API (Next.js / Bun / Deno)](./recipes/server-fetch.md)

### Client Adapters
- [TanStack Query (React)](./recipes/client-tanstack-query.md)
- [SWR (React)](./recipes/client-swr.md)
- [Vanilla JavaScript](./recipes/client-vanilla.md)

### Pub/Sub Backends
- [Redis](./recipes/pubsub-redis.md)
- [Ably](./recipes/pubsub-ably.md)
- [Pusher](./recipes/pubsub-pusher.md)
- [Local In-Memory (No Broker)](./recipes/pubsub-none.md)

### Authentication Modes
- [Scoped Identity Tokens (`scopeBy`)](./recipes/auth-scoped.md)
- [Unscoped Public Streams](./recipes/auth-unscoped.md)

### Flagship Integration
- [Full-Stack Next.js + TanStack Query + Redis Reference](./recipes/flagship-full-stack.md)

---

## 📚 API Reference

Generated reference for all public entrypoints:
- [`restale-kit/server`](./reference/server.md)
- [`restale-kit/client`](./reference/client.md)
- [`restale-kit/react`](./reference/react.md)
- [`restale-kit/tanstack-query`](./reference/tanstack-query.md)
- [`restale-kit/swr`](./reference/swr.md)
- [`restale-kit/pubsub`](./reference/pubsub.md)
- [`restale-kit/redis`](./reference/redis.md)
- [`restale-kit/ably`](./reference/ably.md)
- [`restale-kit/pusher`](./reference/pusher.md)
- [`restale-kit/testing`](./reference/testing.md)

---

## 📊 Verification & Coverage

- [**Pairwise Coverage Matrix**](./coverage-matrix.md) — Continuously verified test matrix with 0 usage gaps.
