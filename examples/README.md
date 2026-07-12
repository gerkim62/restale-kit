# ReStale examples

Each backend is a small HTTP/SSE Todo server. There is no starter-template
configuration, test scaffolding, or persistence layer.

- **Zod validation:** Express, Hono, and the React Query client pass Zod schemas
  for request data and ReStale signals.
- **No Zod validation:** Fastify, native Node, and the SWR client use the same
  flow without application-level Zod parsing.

Run a backend and its matching client in separate terminals:

```sh
pnpm dev:hono
pnpm dev:client
```

Or use the no-Zod pair:

```sh
pnpm dev:fastify
pnpm dev:swr
```

The Vite proxy defaults to Hono. Change its target to port `3002` for Fastify,
or use `pnpm dev:express` and `pnpm dev:node` to run the other backend variants.
