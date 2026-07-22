# ⚡️ restale-kit

[![npm version](https://img.shields.io/npm/v/restale-kit.svg?style=flat-down)](https://www.npmjs.com/package/restale-kit)
[![license](https://img.shields.io/npm/l/restale-kit.svg?style=flat-down)](https://github.com/gerkim62/restale-kit/blob/main/LICENSE)
[![ESM-only](https://img.shields.io/badge/module-ESM--only-blue.svg?style=flat-down)](https://nodejs.org/api/esm.html)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg?style=flat-down)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-down)](https://github.com/gerkim62/restale-kit/blob/main/README.md#-contributing--community)

> **Real-time cache-invalidation signals from your server to TanStack Query & SWR over Server-Sent Events.**
>
> Push cache invalidations instantly when backend data changes — zero polling, zero WebSocket overhead, zero manual cache management. One job, done exceptionally well.

---

## 🧭 How It Works

```mermaid
flowchart LR
    subgraph Server ["Server (Node / Hono / Express / Fastify)"]
        db[(DB Write)] --> app[App Logic]
        app --> group[SSEChannelGroup]
        group --> wire((SSE Stream))
    end
    subgraph Client ["Client (React / Vanilla JS)"]
        wire --> client[useReStale / SSEInvalidatorClient]
        client --> adapter[tanstackQueryAdapter / swrAdapter]
        adapter --> cache[TanStack Query / SWR]
        cache --> ui[UI Rerender]
    end
```

---

## ✨ Features

- **🚀 Framework Agnostic:** Zero runtime dependencies in core. Runs in Node.js, Bun, Deno, Cloudflare Workers, and modern browsers.
- **🔄 Auto-Refetching:** Native client adapters for **TanStack Query** and **SWR** trigger automatic refetches or cache purges upon signal receipt.
- **🔌 First-Class Server Adapters:** Drop-in support for Express, Fastify, Hono, Node `http`, and standard Fetch API runtimes.
- **🎯 Precision Invalidation:** Flexible key matching supports prefix keys, exact matches, and object-subset targeting.
- **🛡️ Standard Schema Validation:** Validate invalidation payloads on server & client using Zod, Valibot, ArkType, or any Standard Schema validator.
- **🌐 Horizontally Scalable:** Pub/Sub adapters for Redis, Ably, and Pusher enable multi-instance and serverless cluster invalidations.
- **⚡️ Resilience Built-In:** Automatic client reconnects with exponential backoff, jitter, and history replay via `Last-Event-ID`.

---

## 🚀 Quick Start

### 1. Install

```sh
pnpm add restale-kit
# or
npm install restale-kit
```

### 2. Server (Express)

```ts
import express from 'express'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/express'

const app = express()
const group = new SSEChannelGroup()

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  group.register(channel, { userId: req.user.id })
})

app.post('/api/todos', async (req, res) => {
  // ... database mutation ...
  group.broadcastToAll({ key: ['todos'] })
  res.status(201).json({ success: true })
})

app.listen(3000)
```

### 3. Client (React + TanStack Query)

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useReStale } from 'restale-kit/react'
import { useTanstackQueryAdapter } from 'restale-kit/tanstack-query'

function TodoList() {
  const queryClient = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter(queryClient)

  useReStale('/sse', { onInvalidate })

  const { data: todos } = useQuery({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then(r => r.json()),
  })

  return (
    <ul>
      {todos?.map((t: any) => <li key={t.id}>{t.title}</li>)}
    </ul>
  )
}
```

---

## 📂 Repository & Workspace Layout

This repository is a monorepo powered by `pnpm` containing the core library, documentation, design specifications, and runnable example apps:

- **[restale-kit/](./restale-kit/)** — The published NPM library source code (server & client adapters, pub/sub drivers, standard schema support).
- **[docs/](./docs/)** — Detailed user documentation and integration guides.
  - 📖 [Getting Started](./docs/getting-started.md)
  - 🖥️ [Server Adapters](./docs/server.md)
  - 💻 [Client Adapters](./docs/client.md)
  - 🛡️ [Payload Validation](./docs/validation.md)
  - 🌐 [Distributed Pub/Sub](./docs/pubsub.md)
  - 📚 [API Reference](./docs/api-reference.md)
- **[examples/](./examples/)** — Ready-to-run backend and frontend examples.
  - Backend: [Express](./examples/backend/express/), [Hono](./examples/backend/hono/), [Fastify](./examples/backend/fastify/), [Node http](./examples/backend/node/)
  - Frontend: [React + TanStack Query](./examples/frontend/react-query/), [React + SWR](./examples/frontend/react-swr/)
  - Full-stack: [Vercel Serverless + Redis](./examples/vercel-redis/)
- **[spec/](./spec/)** — Architectural decision records, frame guard specifications, and wire protocol definitions.

---

## 🤝 Contributing & Community

We warmly welcome contributions from everyone! Whether you are fixing a typo, improving documentation, writing tests, adding an adapter, or building an example app — your contributions make **restale-kit** better for the entire developer community.

### 🌟 Ways You Can Contribute

- **📖 Documentation & Examples:** Improve existing docs, fix typos, or create example apps for your favorite web frameworks (e.g. Next.js, Nuxt, Remix, Astro).
- **🔌 Adapters & Drivers:** Build new server adapters or pub/sub integrations (e.g. NATS, RabbitMQ, Kafka, GCP PubSub).
- **🐛 Bug Reports & Fixes:** Report bugs with reproduction steps or submit PRs to fix open issues.
- **💡 Feature Ideas:** Join discussions and propose new ideas to enhance the developer experience.

### 🛠️ Local Development Setup

1. **Clone the Repository:**
   ```sh
   git clone https://github.com/gerkim62/restale-kit.git
   cd restale-kit
   ```

2. **Install Dependencies:**
   ```sh
   pnpm install
   ```

3. **Build the Core Library:**
   ```sh
   pnpm run build
   ```

4. **Run Validation & Typecheck:**
   ```sh
   pnpm run validate
   ```

5. **Run the Test Suite:**
   ```sh
   # Unit tests & consumer package verification
   pnpm run test:package

   # Full CI test run (with coverage)
   pnpm run test:ci
   ```

6. **Interactive Example Playground:**
   Run the interactive script to select and launch backend and frontend example servers concurrently:
   ```sh
   pnpm example
   ```

   Or run specific services individually:
   | Command | Description |
   |---|---|
   | `pnpm dev:express` | Runs the Express backend example |
   | `pnpm dev:hono` | Runs the Hono backend example |
   | `pnpm dev:fastify` | Runs the Fastify backend example |
   | `pnpm dev:node` | Runs the native Node HTTP backend example |
   | `pnpm dev:client` | Runs the React + TanStack Query frontend example |
   | `pnpm dev:swr` | Runs the React + SWR frontend example |

### 📋 Pull Request Guidelines

1. **Create a Feature Branch:** `git checkout -b feature/my-amazing-feature` or `fix/my-bug-fix`
2. **Keep Changes Focused:** Small, self-contained PRs are easier to review.
3. **Verify Quality:** Before submitting, make sure `pnpm run validate` and `pnpm run test:package` pass cleanly.
4. **Update Docs:** If introducing a new API or behavior change, please update the corresponding guide in `docs/`.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](./restale-kit/README.md) for details.
