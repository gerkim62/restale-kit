```
restale-kit/
├── package.json          # single package with "exports" map
├── tsconfig.json
├── src/
│   ├── core/             # wire protocol types + server-side SSE channel
│   │   ├── types.ts
│   │   ├── framing.ts
│   │   ├── channel.ts
│   │   └── index.ts
│   ├── client-core/      # connection state machine, reconnect, event emitting
│   │   ├── types.ts
│   │   ├── validation.ts
│   │   ├── backoff.ts
│   │   ├── client.ts
│   │   └── index.ts
│   ├── node/             # Node http transport
│   │   ├── attach.ts
│   │   └── index.ts
│   ├── fetch/            # Fetch API transport
│   │   ├── response.ts
│   │   └── index.ts
│   ├── react/            # useReStale hook
│   │   ├── useReStale.ts
│   │   └── index.ts
│   └── tanstack-query/   # TanStack Query adapter
│       ├── adapter.ts
│       └── index.ts
```

Single publishable package with subpath exports — not a monorepo. One `package.json`, one version,
one `npm publish`.

**Subpath exports:**

| Import path | Subpath |
|---|---|
| `restale-kit` | `./src/core/` |
| `restale-kit/client-core` | `./src/client-core/` |
| `restale-kit/node` | `./src/node/` |
| `restale-kit/fetch` | `./src/fetch/` |
| `restale-kit/react` | `./src/react/` |
| `restale-kit/tanstack-query` | `./src/tanstack-query/` |

