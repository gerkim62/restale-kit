# restale-kit — Vitest migration and test plan

## Purpose and current baseline

`restale-kit` has five TypeScript suites under `src/__tests__` (1,100 lines) but executes their compiled output with `node:test`:

```json
"test": "pnpm run build:test && node --test --test-force-exit dist/__tests__/*.test.js && pnpm run build"
```

The migration should make source tests fast to run and watchable, while retaining a separate TypeScript check. Vitest transpiles tests but does not type-check them.

The existing suites already cover adapters, pub/sub, client basics, Last-Event-ID, and revocation. The next tests should target untested runtime modules and behavior at public boundaries—not implementation-private fields.

## Migration decisions

- Default to Vitest's `node` environment. `SSEInvalidatorClient` can use a local `EventSource` mock in Node; only React hook tests need a DOM environment.
- Keep test files beside their source (`*.test.ts`) after the mechanical port. They must be excluded from the production build or they will be emitted into `dist` and included in the npm package.
- Import `describe`, `it`, `expect`, `vi`, and lifecycle helpers from `vitest` explicitly. This keeps the existing TypeScript configuration simple and avoids ambient test globals.
- Port the five existing suites before adding coverage gates or broad new scenarios. Preserve their behavioral assertions; do not use a blind `assert` → `expect` replacement.
- Do not use `node --test --test-force-exit` after the port. A forced process exit can hide leaked handles rather than fixing them.

## Dependencies and configuration

Install only what the first migration needs:

```bash
pnpm --filter restale-kit add -D vitest @vitest/coverage-v8
pnpm --filter restale-kit add -D jsdom @testing-library/react
```

`@testing-library/react` already provides `renderHook`; `@testing-library/react-hooks-alt` is unnecessary. Add `@vitest/ui` only if a UI command is wanted.

Create `restale-kit/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: { '@': src },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
})
```

Do not use `__dirname` in this ESM config. Do not exclude `src/types/**` from coverage: `protocol.ts` and `standard-schema.ts` contain runtime code. Mark the React suite with this first line instead of making every client test use jsdom:

```ts
// @vitest-environment jsdom
```

Update `restale-kit/package.json`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
"typecheck": "tsc -p tsconfig.json --noEmit",
"release:check": "pnpm run typecheck && pnpm run test:coverage && pnpm run build && npm pack --dry-run"
```

Remove `build:test` once nothing uses it. Also update `restale-kit/tsconfig.build.json`; the present exclusion only covers the old central directory:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/**/__tests__/**"]
}
```

> **✅ Done** — `src/test-fixtures/**` has been added to the exclude list. Current `tsconfig.build.json` reads:
> ```json
> {
>   "extends": "./tsconfig.json",
>   "exclude": ["src/**/*.test.ts", "src/**/__tests__/**", "src/test-fixtures/**"]
> }
> ```

## Test layout and shared fixtures

Migrate progressively to this shape:

```
src/
  server/core/{event-store,framing,channel,channel-group}.test.ts
  server/{transport-utils,node/attach,fetch/response}.test.ts
  client/core/{validation,backoff,sse-client}.test.ts
  client/react/useReStale.test.ts
  client/{swr,tanstack-query}/adapter.test.ts
  pubsub/core/{envelope,pubsub-utils}.test.ts
  pubsub/{redis,ably,pusher}/index.test.ts
  types/{protocol,standard-schema}.test.ts
  utils/{id,url}.test.ts
  test-fixtures/{event-source,schemas,pubsub}.ts   ← actual location (was test/fixtures/ in early draft)
```

Use a controllable `MockEventSource` fixture for client tests, a deferred-promise helper for subscription races, a small Standard Schema v1 double, and an in-memory `PubSubAdapter` bus. Restore globals and timers in `afterEach`; use fake timers for all retry and keepalive tests. Framework re-export files need only a smoke test for their actual exports: `attachSSE` for Express/Fastify and `toSSEResponse` for Hono/fetch.

## Required behavioral coverage

### Foundational contracts

- `types/protocol.ts`: JSON-safe key recognition; prefix versus exact array/object matching; null and type mismatches; nested values; invalid cache keys returning `false`. Include non-finite numbers (`NaN`, `Infinity`) as a contract decision: the comment promises lossless JSON round-trips, but the current implementation accepts them, so this test should be introduced with the corresponding fix.
- `types/standard-schema.ts` and `types/errors.ts`: success values; issues with string and `{ key }` path segments; synchronous rejection of async schemas.
- `utils/url.ts`: relative and absolute URLs, queries, hashes, replacement of an existing key, and encoded values. `utils/id.ts`: native UUID and a fallback exercised by stubbing a `crypto` object that supplies `getRandomValues` (do not merely delete `randomUUID`).

### Server core

- `event-store.ts`: generated/custom IDs, overflow, clear, and `getEventsAfter`. A missing or evicted ID returns `{ events: [], stale: true }` to trigger full-invalidation frame `{ key: [] }`.
- `framing.ts`: exact bytes for keepalives and invalidation frames, numeric IDs, and CR/LF removal from IDs.
- `channel.ts`: close/cancel idempotency; validation before enqueue (including an invalid item in a batch); IDs and event stores; replay; and fake-timer keepalives. When `EventStore.getEventsAfter` returns `stale: true`, a channel constructed with a missing or evicted `lastEventId` emits a full-invalidation frame (`{ key: [] }`).

- `channel-group.ts`: metadata validation, re-registration/topic cleanup, local filtering, closed-channel cleanup, aggregate failures, event-ID sharing, local-before-broker publish order, and revocation/control messages. Cover subscription races through public registration/deregistration behavior.

For topic and control subscription retries, assert five total attempts and waits of **100, 200, 400, and 800 ms** between them. The source doubles the delay after each wait, but it gives up on the fifth failure; there is no 1,600 ms wait. `TopicManager` currently polls using `setInterval` plus `Date.now`, so fake-time tests must advance both timers and clock. If this is awkward, first refactor the sleep helper to an injectable/simple timeout, then test the behavior.

### Client core and framework adapters

- `validation.ts`: malformed JSON; scalar/null payloads; empty batches; invalid signal objects; invalid `key`, `exact`, and `action`; normalization and removal of unknown fields. JSON parsing cannot yield functions, so do not claim a hostile JSON payload can contain one.
- `backoff.ts`: no-jitter progression/cap, deterministic jitter endpoints by mocking `Math.random`, and overrides.
- `sse-client.ts`: promise identity while connecting; open/error/retry/exhaustion; close and reopen; credentials and stable request ID; event validation/schema transformation; error events; and `lastEventId` updates. Use the mock rather than jsdom.
- `useReStale.ts`: disabled/mount behavior, URL replacement cleanup, callback freshness, exposed reconnect/close, and status-store re-renders. The current hook calls `client.close()`, whose public status reason is `'manual'`; it does **not** set `'unmount'`. Either test the current behavior or change the client API and implementation first—do not assert an unimplemented unmount reason.
- SWR and TanStack adapters: default/custom key conversion, exactness, action mapping, and batches. A minimal structural QueryClient mock is appropriate.

### Pub/sub and transports

- `pubsub-utils.ts`: its actual guard boundary—`isSignalPayload` currently checks that signal objects have an array `key`; it does not validate every key member as a JSON value or reject an empty array. Add stronger expectations only with a deliberate implementation change.
- `envelope.ts`: wrapped messages, self-echo filtering, valid legacy signals, and invalid object envelopes. Invalid JSON strings currently make `JSON.parse` throw; they do **not** return `null`, despite the broad malformed-message wording in the comment. Decide whether to catch-and-return-null, then add that regression test.
- Redis/Ably/Pusher: adapter-specific subscription, unsubscribe, origin filtering, errors, and provider interaction with existing mocks.
- `transport-utils.ts`, `attachSSE`, and `toSSEResponse`: connection ID and Last-Event-ID precedence; headers; stream delivery; Node close and Fetch abort disconnection. `extractLastEventId` uses `get(lowercase) || get('Last-Event-ID')`, so test that fallback and first-array-element behavior.

## Coverage and CI

Start coverage in report-only mode. The previously proposed glob-keyed `coverage.thresholds` object is not a valid way to express directory thresholds. Use one global threshold first, or configure Vitest's supported per-file threshold option after the suite has stabilized. Do not add an 80% gate before the new tests exist.

Once coverage is meaningful, CI can run each concern once:

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm run validate
- run: pnpm --filter restale-kit run test:coverage
- run: pnpm run build
- run: node scripts/verify-package.mjs
- run: cd restale-kit && npm pack --dry-run
```

This replaces the current duplicate test execution (`restale-kit run test` followed by `test:package`, which invokes it again). Keep `validate` separate because Vitest is not a type checker.

## Delivery order

1. Add dependencies/config/scripts and the build exclusion; port the five existing suites unchanged in intent.
2. Establish fixtures and add foundational protocol/schema/url tests.
3. Cover server core, then client core and pub/sub core.
4. Add adapters, transports, and React tests.
5. Resolve the explicitly identified contract mismatches before encoding them as tests.
6. Enable a measured coverage threshold and update CI after a green baseline.
