# sse-query-invalidator-workspace

Welcome to the development workspace for **restale-kit**! This repository is a monorepo containing the `restale-kit` package code, developer documentation, and several frontend/backend example integrations to test and demonstrate the library.

---

## 📂 Workspace Structure

- **[restale-kit](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/)**: The core library published to npm. Contains the client and server implementation along with integrations for TanStack Query, SWR, Redis, Ably, and Pusher.
  - See the [restale-kit consumer README](file:///home/gerison/coding/experiments/sse-query-invalidator/restale-kit/README.md) for usage documentation.
- **[examples](file:///home/gerison/coding/experiments/sse-query-invalidator/examples/)**: Sample code for both frontends and backends demonstrating the integration in action.
  - **[examples/backend](file:///home/gerison/coding/experiments/sse-query-invalidator/examples/backend/)**: Implementations using Hono, Express, Fastify, and native Node.
  - **[examples/frontend](file:///home/gerison/coding/experiments/sse-query-invalidator/examples/frontend/)**: Clients built with Vite + React + TanStack Query / SWR.
- **[docs](file:///home/gerison/coding/experiments/sse-query-invalidator/docs/)**: Additional design documents, API contracts, pub/sub specifications, and notes.

---

## 🛠️ Development & Commands

### 1. Installation
Install workspace dependencies:
```sh
pnpm install
```

### 2. Validation & Testing
Build, check types, run linter, and run test suites:
```sh
# Lint all workspace files
pnpm run lint

# Build and verify the npm package targets
pnpm run validate

# Run the adapters and pubsub test suite + package checks
pnpm run test:package
```

### 3. Interactive Examples
To launch an interactive CLI to choose a frontend and backend pairing to run locally:
```sh
pnpm example
```

Alternatively, run specific dev tasks in separate terminals:
- **Express Backend:** `pnpm dev:express`
- **Hono Backend:** `pnpm dev:hono`
- **Fastify Backend:** `pnpm dev:fastify`
- **Native Node Backend:** `pnpm dev:node`
- **React-Query Client:** `pnpm dev:client`
- **React-SWR Client:** `pnpm dev:swr`

---

## 📄 License

MIT
