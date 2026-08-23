# ReStale examples

Each backend is a small HTTP/SSE Todo server. There is no starter-template
configuration, test scaffolding, or persistence layer.

Start a backend and frontend interactively:

```sh
pnpm example
```

The launcher prints the local frontend URL after you choose both applications.

The client then asks you to sign in as Ada, Grace, or Linus. Each demo session
has its own Todo list and SSE invalidation stream.

- **Zod validation:** Express and Hono backends use Zod schemas for HTTP
  request bodies, query parameters, and metadata validation.
- **No Zod validation:** Fastify and native Node backends demonstrate the same
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
