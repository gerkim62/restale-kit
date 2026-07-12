```
restale-kit/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
│
├── packages/
│   │
│   ├── core/
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── framing.ts
│   │   │   ├── channel.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── client-core/
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── backoff.ts
│   │   │   ├── client.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── node/
│   │   ├── src/
│   │   │   ├── attach.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── fetch/
│   │   ├── src/
│   │   │   ├── response.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── react/
│   │   ├── src/
│   │   │   ├── useReStale.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── tanstack-query/
│       ├── src/
│       │   ├── adapter.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── examples/
│   ├── express/
│   │   ├── server.ts
│   │   └── package.json
│   ├── hono/
│   │   ├── server.ts
│   │   └── package.json
│   └── react-app/
│       ├── src/
│       │   ├── App.tsx
│       │   └── main.tsx
│       └── package.json
│
└── docs/
    ├── contract.md
    └── adding-adapters.md
```

**Package names become:**

| Package | Name |
|---|---|
| `core` | `restale-kit` |
| `client-core` | `restale-kit/client-core` |
| `node` | `restale-kit/node` |
| `fetch` | `restale-kit/fetch` |
| `react` | `restale-kit/react` |
| `tanstack-query` | `restale-kit/tanstack-query` |

The hook rename from `useSSEInvalidator` → `useReStale` fits the package name and is the one public API surface that changes for end users.