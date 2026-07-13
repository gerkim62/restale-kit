# sse-query-invalidator-workspace

Development workspace for **restale-kit** — a monorepo containing the library source, documentation, design specs, and example integrations.

---

## 📂 Workspace Structure

- **[restale-kit/](./restale-kit/)** — The core library published to npm. Contains all server adapters, client adapters, and pub/sub integrations.
  - [restale-kit/README.md](./restale-kit/README.md) — Library usage documentation (also on npm).
- **[docs/](./docs/)** — User-facing documentation guides.
  - [Getting Started](./docs/getting-started.md), [Server](./docs/server.md), [Client](./docs/client.md), [Validation](./docs/validation.md), [Pub/Sub](./docs/pubsub.md), [API Reference](./docs/api-reference.md)
- **[spec/](./spec/README.md)** — Design documents, wire protocol contracts, and architectural decision records.
- **[examples/](./examples/)** — Sample frontends and backends demonstrating the integration.
  - **[examples/backend/](./examples/backend/)** — Hono, Express, Fastify, and native Node implementations.
  - **[examples/frontend/](./examples/frontend/)** — Vite + React + TanStack Query and SWR clients.

---

## 🛠️ Development

### Install
```sh
pnpm install
```

### Validate (typecheck + lint)
```sh
pnpm run validate
```

### Run tests
```sh
pnpm run test:package
```

### Interactive examples
```sh
pnpm example
```

Or run specific stacks in separate terminals:

| Command | Description |
|---|---|
| `pnpm dev:express` | Express backend |
| `pnpm dev:hono` | Hono backend |
| `pnpm dev:fastify` | Fastify backend |
| `pnpm dev:node` | Native Node backend |
| `pnpm dev:client` | React + TanStack Query frontend |
| `pnpm dev:swr` | React + SWR frontend |

---

## 📄 License

MIT
