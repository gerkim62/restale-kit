# Audit Shard 06: Examples & Scripts

## Scope
- Examples:
  - `examples/README.md`
  - `examples/backend/express/src/index.ts`
  - `examples/backend/fastify/src/index.ts`
  - `examples/backend/hono/src/index.ts`
  - `examples/backend/node/src/index.ts`
  - `examples/frontend/react-query/src/App.tsx`
  - `examples/frontend/react-swr/src/App.tsx`
  - `examples/shared/src/index.ts`
  - `examples/vercel-redis/api/_lib.js`
  - `examples/vercel-redis/api/sse.js`
- Scripts:
  - `scripts/extract-changelog.mjs`
  - `scripts/run-example.mjs`
  - `scripts/verify-package.mjs`

---

## Discrepancies

### [DISC-06-01] Redundant manual connection cleanup in Vercel Redis example conflicting with server guide
- **Area:** `docs/server.md:L161`, `examples/vercel-redis/api/_lib.js:L34`
- **Type:** contradiction
- **Evidence:**
  - `docs/server.md:L161`:
    `Automatic cleanup: When a channel closes (peer disconnect, server close(), or stream cancellation), it is automatically deregistered from the group. You do not need a manual req.on('close', ...) listener for cleanup.`
  - `examples/vercel-redis/api/_lib.js:L34`:
    ```js
    export function openSse(req, res, userId) {
      const channel = attachSSE(req, res)
      group.register(channel, undefined, { topics: [topic(userId)] })
      req.once('close', () => group.deregister(channel))
    }
    ```
- **Discrepancy:** `_lib.js` adds a manual `req.once('close', () => group.deregister(channel))` listener, which is redundant because `group.register()` automatically wires `channel.onClose(() => this.deregister(channel))`. This contradicts `docs/server.md`'s recommendation.
- **Which source is correct / should be trusted:** `docs/server.md` and `SSEChannelGroup` implementation. Automatic deregistration is handled natively by `group.register`.
- **Recommended fix:** Remove `req.once('close', ...)` from `examples/vercel-redis/api/_lib.js`.
- **Severity:** low
- **Confidence:** high

### [DISC-06-02] Fastify example using manual optional chaining on `meta` in predicate instead of typed metadata
- **Area:** `examples/backend/fastify/src/index.ts:L10`, `examples/backend/express/src/index.ts:L17`
- **Type:** contradiction
- **Evidence:**
  - `examples/backend/fastify/src/index.ts:L10`:
    ```ts
    const group = new SSEChannelGroup<InvalidateSignal, { userId: string }>()
    const todos = createTodoApi((userId) => {
      group.broadcast({ key: ['todos', { userId }], action: 'invalidate' }, (meta) => meta?.userId === userId)
    })
    ```
  - `examples/backend/express/src/index.ts:L17`:
    ```ts
    const group = new SSEChannelGroup<AppSignal, ClientMeta>()
    const todos = createTodoApi((userId) => {
      group.broadcast({ key: ['todos', { userId }], action: 'invalidate' }, (meta) => meta.userId === userId)
    })
    ```
- **Discrepancy:** In Fastify example, `SSEChannelGroup` is instantiated with `{ userId: string }` (non-optional `userId`). However, the predicate uses `meta?.userId === userId`. In Express and Hono examples, `meta.userId === userId` is used without optional chaining.
- **Which source is correct / should be trusted:** Express and Hono examples. Since `TMeta` is `{ userId: string }`, `meta` is non-nullable.
- **Recommended fix:** Update Fastify example predicate to `(meta) => meta.userId === userId`.
- **Severity:** low
- **Confidence:** high

---

## Verified Correct Behavior (Agreements)
- All example apps (Express, Fastify, Hono, React Query, React SWR, Vercel Redis) import from subpath exports (`restale-kit/server`, `restale-kit/express`, `restale-kit/fastify`, `restale-kit/hono`, `restale-kit/react`, `restale-kit/tanstack-query`, `restale-kit/swr`, `restale-kit/redis`).
- `scripts/verify-package.mjs` verifies all ESM subpath exports against `package.json`.
- `scripts/extract-changelog.mjs` parses standard Keep a Changelog formatting correctly.
