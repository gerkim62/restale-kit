# Vercel + Redis adapter example

A self-contained Vite/React Todo app that deploys to Vercel. Redis is used for both
the Todo data and the `redisPubSubAdapter` that distributes ReStale invalidation
signals between warm Vercel function instances.

## Deploy

1. Create a Redis database that supports **TCP Pub/Sub** (Redis Cloud is one
   option) and copy its TLS connection URL.
2. Import this repository into Vercel and set **Root Directory** to
   `examples/vercel-redis`.
3. Add `REDIS_URL` in Vercel’s environment variables. Use the full TCP URL,
   usually beginning with `rediss://`; HTTP-only Redis APIs cannot run Pub/Sub.
4. Deploy. Open the resulting site in two tabs, choose the same user, and add
   or complete a Todo in one tab. The other tab refetches after the SSE signal.

For local development, copy `.env.example` to `.env.local`, set `REDIS_URL`,
then run the included local server from this directory. It serves the Vite app
and the same `api/` functions that Vercel deploys:

```sh
pnpm install
cd examples/vercel-redis
pnpm dev
```

The app is available at `http://localhost:5173`, including `/api/*` routes.
`pnpm dev:frontend` is available for frontend-only work and deliberately does
not serve API routes.

## How it works

`api/_lib.js` creates an `SSEChannelGroup` with `redisPubSubAdapter`. The SSE
function registers each connection to a user-specific Redis topic. Every Todo write
saves Redis data then calls `group.publish()`: local connections update instantly
and Redis forwards the same invalidation to connections handled by other warm
function instances.

The SSE function sets `maxDuration = 300`; Vercel ends a serverless SSE connection
when its function-duration limit is reached, and the ReStale client reconnects.
Choose a Vercel plan/configuration that permits your desired function duration.
