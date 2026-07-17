```
restale-kit/
├── package.json

├── tsconfig.json
└── src/
    ├── types/              # wire protocol types, schemas, and errors
    ├── server/
    │   ├── core/           # channels and channel groups
    │   ├── node/           # Node HTTP helper
    │   ├── fetch/          # Fetch API helper
    │   ├── express/        # Express adapter
    │   ├── fastify/        # Fastify adapter
    │   └── hono/           # Hono adapter
    ├── client/
    │   ├── core/           # browser SSE client
    │   ├── react/          # React hook
    │   ├── swr/            # SWR integration
    │   └── tanstack-query/ # TanStack Query integration
    ├── pubsub/
    │   ├── core/           # PubSub contract and shared utilities
    │   ├── redis/
    │   ├── ably/
    │   └── pusher/
    ├── utils/              # internal constants, ID generation, and URL utilities
    └── test-fixtures/     # shared test doubles and network mocks
```


The package has four stable top-level domains: `types`, `server`, `client`, and
`pubsub`. Frameworks and providers are nested under the domain they extend.

| Import path | Source entrypoint |
|---|---|
| `restale-kit` | `./src/types/` |
| `restale-kit/server` | `./src/server/core/` |
| `restale-kit/node` | `./src/server/node/` |
| `restale-kit/fetch` | `./src/server/fetch/` |
| `restale-kit/express` | `./src/server/express/` |
| `restale-kit/fastify` | `./src/server/fastify/` |
| `restale-kit/hono` | `./src/server/hono/` |
| `restale-kit/client` | `./src/client/core/` |
| `restale-kit/react` | `./src/client/react/` |
| `restale-kit/swr` | `./src/client/swr/` |
| `restale-kit/tanstack-query` | `./src/client/tanstack-query/` |
| `restale-kit/pubsub` | `./src/pubsub/core/` |
| `restale-kit/redis` | `./src/pubsub/redis/` |
| `restale-kit/ably` | `./src/pubsub/ably/` |
| `restale-kit/pusher` | `./src/pubsub/pusher/` |
