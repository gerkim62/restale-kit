# restale-kit — contract document (v2)

## Purpose

A minimal library that lets a server tell any client-side cache to invalidate specific keys over a
persistent SSE connection. One job, done well.

**Core agnosticism principle:** `core` and `client-core` know nothing about any cache library or UI
framework. They define a generic wire protocol with generic cache operations. Each adapter package
maps those operations to a specific library's API. If you removed every adapter, `core` and
`client-core` would still compile and function — they just wouldn't do anything useful with the
signals.

v1 ships: React + TanStack Query on the client, Node and any Fetch-API runtime (Hono, Bun, Deno,
edge) on the server. The design keeps two seams open — one per axis below — so other frameworks and
cache libraries can be added later without changing `core`, but nothing beyond v1's scope is built
or specced now.

| Axis | v1 | Open seam for later |
|---|---|---|
| Server I/O runtime | Node, Fetch API | any runtime that can produce a byte stream |
| UI framework | React | any framework — wrap `client-core` the way `react` does |
| Cache library | TanStack Query | any library — write a `(signal) => void` adapter the way `tanstack-query` does |

---

## Package structure

Single publishable package with subpath exports — not a monorepo of separate packages. One
`package.json`, one version, one `npm publish`.

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

**`package.json` exports map:**

```json
{
  "name": "restale-kit",
  "exports": {
    ".":               { "types": "./dist/core/index.d.ts",           "import": "./dist/core/index.js" },
    "./client-core":   { "types": "./dist/client-core/index.d.ts",    "import": "./dist/client-core/index.js" },
    "./node":          { "types": "./dist/node/index.d.ts",           "import": "./dist/node/index.js" },
    "./fetch":         { "types": "./dist/fetch/index.d.ts",          "import": "./dist/fetch/index.js" },
    "./react":         { "types": "./dist/react/index.d.ts",          "import": "./dist/react/index.js" },
    "./tanstack-query": { "types": "./dist/tanstack-query/index.d.ts", "import": "./dist/tanstack-query/index.js" }
  },
  "type": "module"
}
```

- **Module format:** ESM-only. No CJS build.
- **TypeScript target:** ES2022 (guarantees `ReadableStream`, `EventTarget`, `structuredClone`).
- **No framework/library peer dependencies in root `package.json`.** Framework-specific subpaths
  (`restale-kit/react`, `restale-kit/tanstack-query`) import from `react` and
  `@tanstack/react-query` respectively — if those aren't installed, TypeScript errors at compile
  time and bundlers error at build time. This is sufficient enforcement and keeps the package
  manifest framework-agnostic. A Vue user installing `restale-kit` to use only `client-core` sees
  zero React-related anything.

Express and Fastify both sit on Node's `http` module, so both use `restale-kit/node`
directly (Fastify needs `reply.hijack()` first — see below). Hono, Bun, Deno, and edge runtimes
speak `Request`/`Response`, so all of them use `restale-kit/fetch`. No per-framework
server packages exist.

---

## Wire protocol

### Types

```ts
type JSONValue =
  | string | number | boolean | null
  | JSONValue[]
  | { [key: string]: JSONValue }

interface InvalidateSignal {
  key: JSONValue[]          // hierarchical key — e.g. ["todos", { userId: 4 }]
  exact?: boolean           // default false: prefix match
  action?: 'invalidate' | 'refetch' | 'remove'   // default 'invalidate'
}

type SSEInvalidateEvent = InvalidateSignal | InvalidateSignal[]
```

These types are **cache-library-agnostic**. The three actions map to generic cache operations:

| Wire action | Meaning (generic) | TanStack Query mapping |
|---|---|---|
| `'invalidate'` (default) | Mark matching entries as stale; refetch if observed | `queryClient.invalidateQueries()` |
| `'refetch'` | Force immediate refetch of matching entries | `queryClient.refetchQueries()` |
| `'remove'` | Purge matching entries from cache entirely | `queryClient.removeQueries()` |

Other adapters (SWR, Apollo, custom) would map the same three actions to their own equivalents.

### Exact SSE frame format

Each call to `channel.invalidate()` produces exactly one SSE event:

```
event: invalidate\n
data: <JSON payload>\n
\n
```

Where `<JSON payload>` is the output of `JSON.stringify(signal)` — a single object or an array.
The entire payload is sent as one `data:` line. No splitting across multiple `data:` lines.

**No `id:` field.** The library does not replay missed events (documented in "What this library
does not do"), so setting `id:` would give `EventSource` a false `Last-Event-ID` that the server
would ignore, which is misleading. Omitting it keeps the contract honest.

**Example frames:**

Single signal:
```
event: invalidate
data: {"key":["todos"],"exact":false}

```

Batch signal:
```
event: invalidate
data: [{"key":["todos"]},{"key":["todos-count"]}]

```

Signal with action:
```
event: invalidate
data: {"key":["user",{"userId":4}],"exact":true,"action":"remove"}

```

### Keepalive

Periodic SSE comment to prevent proxies/load balancers from dropping idle connections:

```
: keepalive\n
\n
```

- Default interval: **30 seconds**.
- Configurable via `keepaliveIntervalMs` in `createSSEChannel` options.
- The comment is a standard SSE comment (`:` prefix) — `EventSource` silently ignores it.

### Initial connection

No special event is sent when a client connects. The stream begins producing keepalives
immediately. The first `invalidate` event arrives whenever `channel.invalidate()` is first called.

---

### Serialization & key semantics

**`key: JSONValue[]`** — not `QueryKey` from TanStack, not `any[]`. This constraint is intentional:

- `JSON.stringify` / `JSON.parse` is lossless for `JSONValue` in both directions.
- Non-plain values (`Date`, `Map`, class instances, functions) that don't survive the round trip
  are rejected at the type level, not silently mangled at runtime.
- Keeps `core` free of any cache-library import.

**`[]` as a key:** matches everything. Intentional — useful for "invalidate everything after a
deploy." Adapters must not guard against it; the sender is trusted to mean it.

**Event naming:** named SSE event `event: invalidate`, not the default `message` event, for clean
filtering.

---

## Server side

### `restale-kit` (core)

Runtime-agnostic. Produces a standard `ReadableStream<Uint8Array>` rather than writing into a
Node-specific response object — this is what lets the Fetch-API transport exist without forking the
protocol logic.

```ts
type ChannelState = 'open' | 'closed'

interface SSEChannel {
  readonly state: ChannelState
  readonly stream: ReadableStream<Uint8Array>
  invalidate(signal: InvalidateSignal | InvalidateSignal[]): void
  close(): void
  notifyClosed(): void   // called by a transport adapter when it detects the peer disconnected
}

interface SSEChannelOptions {
  keepaliveIntervalMs?: number   // default 30_000
}

function createSSEChannel(options?: SSEChannelOptions): SSEChannel
```

`core` handles SSE framing and keepalives. It does not detect disconnects or set response headers —
that's the transport adapter's job.

#### Channel lifecycle state machine

```
  ┌─────────────────────────┐
  │       [open]            │
  │                         │
  │  invalidate() → ok      │
  │  close() → transition   │
  │  notifyClosed() → trans │
  └────────┬────────────────┘
           │ close() or notifyClosed()
           ▼
  ┌─────────────────────────┐
  │      [closed]           │
  │                         │
  │  invalidate() → throws  │
  │  close() → no-op        │
  │  notifyClosed() → no-op │
  └─────────────────────────┘
```

**Rules:**

| Method | State: `open` | State: `closed` |
|---|---|---|
| `invalidate(signal)` | Enqueues the SSE frame into the stream | Throws `ChannelClosedError` |
| `close()` | Stops keepalive timer, closes the `ReadableStream` controller, transitions to `closed` | No-op |
| `notifyClosed()` | Same as `close()` — called by transport when peer disconnects | No-op |

`invalidate()` throws rather than silently dropping the signal, because a dropped signal means the
client's cache is now silently wrong. The caller should know.

#### `ChannelClosedError`

```ts
class ChannelClosedError extends Error {
  readonly name = 'ChannelClosedError'
}
```

Exported from `restale-kit` (core).

#### Backpressure

v1: unbounded internal buffer. If the client can't consume fast enough, frames accumulate in the
`ReadableStream`'s internal queue. This is acceptable for the expected payload sizes (small JSON
objects at low frequency). A future version may add a `maxBufferSize` option with a configurable
overflow strategy.

---

### `restale-kit/node`

```ts
function attachSSE(req: IncomingMessage, res: ServerResponse, options?: SSEChannelOptions): SSEChannel
```

Sets SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`,
`Connection: keep-alive`), pipes `channel.stream` into `res` via
`Readable.fromWeb(channel.stream).pipe(res)`, wires `req.on('close', channel.notifyClosed)`.

For Fastify: pass `request.raw` / `reply.raw`, and call `reply.hijack()` first — otherwise Fastify
sends its own response on top of the streamed one and throws.

### `restale-kit/fetch`

```ts
function toSSEResponse(request: Request, options?: SSEChannelOptions): { response: Response; channel: SSEChannel }
```

Constructs `new Response(channel.stream, { headers })`, wires
`request.signal.addEventListener('abort', channel.notifyClosed)`. Returns a `Response` for the
handler to `return` — inverted control flow vs. the Node adapter, because that's how Fetch-API
frameworks work:

```ts
app.get('/sse', (c) => {
  const { response, channel } = toSSEResponse(c.req.raw)
  registerChannel(channel) // call channel.invalidate(...) from app logic elsewhere
  return response
})
```

Auth, per-user scoping, and event filtering are out of scope — left to the user.

---

## Client side

### `restale-kit/client-core`

No UI framework, no cache library dependency.

```ts
type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' }
  | { status: 'error'; error: Event }

interface ReconnectOptions {
  baseDelayMs?: number    // default 1_000
  maxDelayMs?: number     // default 30_000
  jitter?: boolean        // default true
  maxRetries?: number     // default Infinity (unlimited)
}

interface ClientOptions {
  autoReconnect?: boolean   // default true
  reconnect?: ReconnectOptions
}

class SSEInvalidatorClient extends EventTarget {
  constructor(url: string, opts?: ClientOptions)
  get status(): ConnectionStatus
  connect(): Promise<void>   // resolves when open; rejects with the error Event if it fails first
  close(): void               // reason 'manual'; connect() can reopen
  // emits: 'invalidate' (CustomEvent<InvalidateSignal | InvalidateSignal[]>)
  //        'statuschange' (CustomEvent<ConnectionStatus>)
  //        'error' (CustomEvent<Event>)
}
```

Built on native `EventSource`.

#### Reconnect strategy

When `autoReconnect` is `true` (default), failed/dropped connections retry with exponential backoff:

```
delay = min(baseDelayMs × 2^attempt, maxDelayMs)
if jitter: delay = delay × random(0.5, 1.5)
```

- `attempt` starts at 0, increments on each consecutive failure, resets to 0 on successful `open`.
- If `maxRetries` is reached, the client transitions to `{ status: 'error', error }` and stops.
- Calling `close()` cancels any pending retry timer.
- When `autoReconnect` is `false`, the connection stays closed until `connect()` is called manually.

**Defaults:**

| Option | Default |
|---|---|
| `baseDelayMs` | `1_000` (1 second) |
| `maxDelayMs` | `30_000` (30 seconds) |
| `jitter` | `true` |
| `maxRetries` | `Infinity` |

#### `connect()` edge cases

| Current state | `connect()` behavior |
|---|---|
| `'open'` | No-op, returns resolved promise |
| `'connecting'` | Returns the same pending promise (does not start a second connection) |
| `'closed'` (manual) | Creates a new `EventSource`, transitions to `'connecting'`, resets backoff counter |
| `'closed'` (unmount) | Same as manual — allows reuse after re-mount |
| `'error'` | Creates a new `EventSource`, transitions to `'connecting'`, resets backoff counter |
| `'error'` + autoReconnect actively backing off | Cancels the pending retry timer, immediately attempts, resets backoff counter |

`connect()`'s internal promise is backed by one-shot `open`/`error` listeners, removed on `close()`
so a pending promise never resolves against a torn-down connection.

#### Payload validation

Every incoming `event: invalidate` payload is validated before being emitted as an `invalidate`
event. A payload that fails validation emits `error` instead.

**Validation rules:**

1. `JSON.parse` must succeed — otherwise error.
2. Result must be a plain object, or an array of plain objects — otherwise error.
3. Each object must have a `key` property that is an `Array` — otherwise error.
4. If `exact` is present, it must be `boolean` — otherwise error.
5. If `action` is present, it must be one of `'invalidate' | 'refetch' | 'remove'` — otherwise error.
6. **Extra unknown fields are ignored** — forward-compatible. A future protocol version can add
   optional fields without breaking existing clients.

---

### `restale-kit/react`

```ts
interface UseReStaleOptions extends ClientOptions {
  disabled?: boolean
  onInvalidate?: (signal: InvalidateSignal | InvalidateSignal[]) => void
}

interface UseReStaleResult {
  connection: ConnectionStatus
  reconnect(): Promise<void>
  close(): void
}

function useReStale(url: string, opts?: UseReStaleOptions): UseReStaleResult
```

Wraps `SSEInvalidatorClient` in a `useSyncExternalStore` subscription:

- **`subscribe`:** listens to `statuschange` events on the client, calls the store's callback.
- **`getSnapshot`:** returns `client.status` (the `ConnectionStatus` object). Reference-stable —
  only changes when status actually transitions.
- **`getServerSnapshot`:** returns `{ status: 'closed', reason: 'unmount' }` — SSE connections
  don't exist during SSR.

Opens on mount unless `disabled`. Closes with reason `'unmount'` on unmount. Knows nothing about
queries or caches — it only forwards `invalidate` events to `onInvalidate`.

---

### `restale-kit/tanstack-query`

The one shipped adapter, and the pattern to copy for any other cache library later:

```ts
function tanstackAdapter(queryClient: QueryClient) {
  return (signal: InvalidateSignal | InvalidateSignal[]) => {
    const list = Array.isArray(signal) ? signal : [signal]
    for (const s of list) {
      const filters = { queryKey: s.key, exact: s.exact }
      switch (s.action) {
        case 'remove':
          queryClient.removeQueries(filters)
          break
        case 'refetch':
          queryClient.refetchQueries(filters)
          break
        case 'invalidate':
        default:
          queryClient.invalidateQueries(filters)
          break
      }
    }
  }
}
```

Usage:

```ts
import { useReStale } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'

const queryClient = useQueryClient()
useReStale('/sse', { onInvalidate: tanstackAdapter(queryClient) })
```

Supporting a different cache library or UI framework later means writing one function or one
`client-core` wrapper in this same shape — not a change to `core` or `client-core`.

---

## Exported type surface

Each subpath export has a defined public API. Only these symbols are exported:

| Subpath | Exported symbols |
|---|---|
| `restale-kit` (core) | `createSSEChannel`, `SSEChannel`, `SSEChannelOptions`, `ChannelState`, `ChannelClosedError`, `InvalidateSignal`, `SSEInvalidateEvent`, `JSONValue` |
| `restale-kit/client-core` | `SSEInvalidatorClient`, `ClientOptions`, `ReconnectOptions`, `ConnectionStatus`, `InvalidateSignal` (re-export from core) |
| `restale-kit/node` | `attachSSE` |
| `restale-kit/fetch` | `toSSEResponse` |
| `restale-kit/react` | `useReStale`, `UseReStaleOptions`, `UseReStaleResult`, `ConnectionStatus` (re-export) |
| `restale-kit/tanstack-query` | `tanstackAdapter` |

`InvalidateSignal` is re-exported from `client-core` so that adapter authors and direct `client-core`
users don't need to also import from core.

---

## Multi-channel broadcasting

The library does not provide a `ChannelGroup` or `broadcast()` helper — that is userland code.

### Broadcast contract

The canonical userland broadcast signature is:

```ts
function broadcast(
  channels: Map<SSEChannel, unknown>,   // or Set — see below
  signal: InvalidateSignal | InvalidateSignal[],
  matchFn?: (meta: unknown) => boolean  // omit to broadcast to all
): void
```

**Rules the implementation must follow:**

1. If `matchFn` is provided, call it with the per-channel metadata before calling
   `channel.invalidate()`. Only channels for which `matchFn(meta)` returns `true` receive the
   signal.
2. If `matchFn` is omitted or `undefined`, send to all channels (unconditional broadcast).
3. If `channel.invalidate()` throws `ChannelClosedError`, remove that channel from the
   collection and continue to the next channel. Never let one closed channel abort the broadcast.
4. Any other error from `channel.invalidate()` is re-thrown immediately.
5. The broadcast must be **synchronous** — all `invalidate()` calls happen in the same
   microtask; no awaiting between channels.

### Recommended data structure: `Map<SSEChannel, Meta>`

A plain `Set<SSEChannel>` is sufficient for unconditional broadcasting, but selective broadcasting
requires the caller to correlate channels with identity metadata (user ID, session ID, tenant, etc.).
The recommended structure is a `Map` from channel to a metadata object chosen by the application:

```ts
// Application defines its own metadata shape — the library has no opinion on this.
interface ClientMeta {
  userId: string
  roles: string[]
}

const channels = new Map<SSEChannel, ClientMeta>()

// On connection:
const channel = attachSSE(req, res)
channels.set(channel, { userId: req.user.id, roles: req.user.roles })

// On disconnect (transport adapter calls channel.notifyClosed(); clean up Map too):
req.on('close', () => {
  channel.notifyClosed()
  channels.delete(channel)
})
```

### Broadcast helpers (userland)

The two patterns callers will write, shown in full so implementations are unambiguous:

**Unconditional broadcast** — every connected client receives the signal:

```ts
function broadcastAll(
  channels: Map<SSEChannel, unknown>,
  signal: InvalidateSignal | InvalidateSignal[]
): void {
  for (const [channel] of channels) {
    try {
      channel.invalidate(signal)
    } catch (e) {
      if (e instanceof ChannelClosedError) channels.delete(channel)
      else throw e
    }
  }
}

// Usage:
broadcastAll(channels, { key: ['todos'] })
```

**Selective broadcast** — only clients whose metadata satisfies the predicate receive the signal:

```ts
function broadcastWhere<Meta>(
  channels: Map<SSEChannel, Meta>,
  signal: InvalidateSignal | InvalidateSignal[],
  matchFn: (meta: Meta) => boolean
): void {
  for (const [channel, meta] of channels) {
    if (!matchFn(meta)) continue
    try {
      channel.invalidate(signal)
    } catch (e) {
      if (e instanceof ChannelClosedError) channels.delete(channel)
      else throw e
    }
  }
}

// Usage — only invalidate todos for user 123:
broadcastWhere(
  channels,
  { key: ['todos', { userId: '123' }], exact: true },
  (meta) => meta.userId === '123'
)

// Usage — invalidate all data for admin users:
broadcastWhere(
  channels,
  { key: ['admin-data'] },
  (meta) => meta.roles.includes('admin')
)
```

### What the library guarantees vs. what is userland

| Concern | Where it lives |
|---|---|
| SSE framing, keepalives, channel lifecycle | `core` |
| Per-channel disconnect detection | transport adapter (`/node`, `/fetch`) |
| Collecting channels, storing metadata | **userland** |
| Deciding which channels to notify | **userland** (`matchFn`) |
| Auth, session identity, roles | **userland** (never touches `core`) |

The `matchFn` predicate is **never passed to `core`**. The library has no routing table, no
subscription registry, and no concept of "which clients want which keys." All of that logic
lives in the application layer, which is the only place that knows about users and sessions.

These patterns are documented in usage examples, not built into the library.

---

## What this library does not do

- Auth, session scoping, CORS
- Event filtering or routing
- Replaying missed events after a reconnect
- Any query fetching, caching, or state management beyond calling into the chosen adapter
- `ChannelGroup` / broadcast helpers (userland — see above)
