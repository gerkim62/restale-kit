# restale-kit — contract document (v2)

## Purpose

A minimal library that lets a server tell any client-side cache to invalidate specific keys over a
persistent SSE connection. One job, done well.

**Dependency boundary:** `server`, `client`, and `types` know nothing about any cache library or UI
framework. They define a generic wire protocol with generic cache operations. Each adapter package
maps those operations to a specific library's API. If you removed every adapter, `core` and
`client` would still compile and function — it just wouldn't do anything useful with the
signals.

v1 ships: React + TanStack Query on the client, Node and any Fetch-API runtime (Hono, Bun, Deno,
edge) on the server. The design keeps two seams open — one per axis below — so other frameworks and
cache libraries can be added later without changing `core`, but nothing beyond v1's scope is built
or specced now.

| Axis | v1 | Open seam for later |
|---|---|---|
| Server I/O runtime | Node, Fetch API | any runtime that can produce a byte stream |
| UI framework | React | any framework — wrap `client` the way `client/react` does |
| Cache library | TanStack Query | any library — write a `(signal) => void` integration like `client/tanstack-query` |

---

## Package structure

Single publishable package with subpath exports — not a monorepo of separate packages. One
`package.json`, one version, one `npm publish`.

```
restale-kit/
├── package.json          # single package with "exports" map
├── tsconfig.json
├── src/
│   ├── types/            # wire protocol types, schemas, and errors
│   ├── server/
│   │   ├── core/         # channels and channel groups
│   │   ├── node/         # Node HTTP helper
│   │   ├── express/      # Express adapter (re-exports from node)
│   │   ├── fastify/      # Fastify adapter (re-exports from node)
│   │   ├── fetch/        # Fetch API helper
│   │   └── hono/         # Hono adapter (re-exports from fetch)
│   ├── client/
│   │   ├── core/         # connection state machine
│   │   ├── react/        # useReStale hook
│   │   ├── swr/          # SWR integration
│   │   └── tanstack-query/ # TanStack Query integration
│   └── pubsub/
│       ├── core/         # contract and shared utilities
│       ├── redis/
│       ├── ably/
│       └── pusher/
```

**`package.json` exports map:**

```json
{
  "name": "restale-kit",
  "exports": {
    ".": { "types": "./dist/types/index.d.ts", "import": "./dist/types/index.js" },
    "./server": { "types": "./dist/server/core/index.d.ts", "import": "./dist/server/core/index.js" },
    "./node": { "types": "./dist/server/node/index.d.ts", "import": "./dist/server/node/index.js" },
    "./express": { "types": "./dist/server/express/index.d.ts", "import": "./dist/server/express/index.js" },
    "./fastify": { "types": "./dist/server/fastify/index.d.ts", "import": "./dist/server/fastify/index.js" },
    "./fetch": { "types": "./dist/server/fetch/index.d.ts", "import": "./dist/server/fetch/index.js" },
    "./hono": { "types": "./dist/server/hono/index.d.ts", "import": "./dist/server/hono/index.js" },
    "./client": { "types": "./dist/client/core/index.d.ts", "import": "./dist/client/core/index.js" },
    "./react": { "types": "./dist/client/react/index.d.ts", "import": "./dist/client/react/index.js" },
    "./swr": { "types": "./dist/client/swr/index.d.ts", "import": "./dist/client/swr/index.js" },
    "./tanstack-query": { "types": "./dist/client/tanstack-query/index.d.ts", "import": "./dist/client/tanstack-query/index.js" },
    "./pubsub": { "types": "./dist/pubsub/core/index.d.ts", "import": "./dist/pubsub/core/index.js" },
    "./redis": { "types": "./dist/pubsub/redis/index.d.ts", "import": "./dist/pubsub/redis/index.js" },
    "./ably": { "types": "./dist/pubsub/ably/index.d.ts", "import": "./dist/pubsub/ably/index.js" },
    "./pusher": { "types": "./dist/pubsub/pusher/index.d.ts", "import": "./dist/pubsub/pusher/index.js" }
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
  manifest framework-agnostic. A Vue user installing `restale-kit` to use only `client` sees
  zero React-related anything.

Express and Fastify both sit on Node's `http` module, so they use `restale-kit/express` and
`restale-kit/fastify` respectively (Fastify needs `reply.hijack()` first — see below). Hono, Bun,
Deno, and edge runtimes speak `Request`/`Response`, so Hono uses `restale-kit/hono`;
`restale-kit/fetch` remains available for other Fetch API runtimes.

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

Each call to `channel.invalidate()` produces exactly one SSE event.

**Without event history** (default — no `eventStore` configured):

```
event: invalidate\n
data: <JSON payload>\n
\n
```

**With event history** (`eventStore` configured or `eventBufferCapacity > 0`):

```
id: <event ID>\n
event: invalidate\n
data: <JSON payload>\n
\n
```

Where `<JSON payload>` is the output of `JSON.stringify(signal)` — a single object or an array.
The entire payload is sent as one `data:` line. No splitting across multiple `data:` lines.

**`id:` field behavior:** By default (no `eventStore`), no `id:` field is emitted — there is
nothing to replay, so advertising an event ID would be misleading. When an `eventStore` is
configured, every event receives an auto-incrementing (or custom-generated) ID. The `id:` field
causes `EventSource` to send `Last-Event-ID` on reconnect, which the server can use to replay
missed events from the store. The `id:` field value is sanitized to strip `\r` and `\n`
characters.

**Example frames:**

Single signal (no event store):
```
event: invalidate
data: {"key":["todos"],"exact":false}

```

Batch signal (no event store):
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

interface SSEChannel<TSignal extends InvalidateSignal = InvalidateSignal> {
  readonly state: ChannelState
  readonly stream: ReadableStream<Uint8Array>
  readonly connectionId: string
  invalidate(signal: TSignal | TSignal[], customId?: string): string
  close(): void
  disconnect(): void   // called by a transport adapter when it detects the peer disconnected
  onClose(callback: () => void): void
}

interface SSEChannelOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  keepaliveIntervalMs?: number   // default 30_000
  signalSchema?: StandardSchemaV1<unknown, TSignal>  // optional — no schema = no validation
  lastEventId?: string           // Last-Event-ID from the reconnecting client
  eventStore?: EventStore<TSignal> // shared store for recording history and replaying missed events
  eventBufferCapacity?: number   // auto-creates an EventStore with this capacity if eventStore is not provided
  idGenerator?: () => string     // custom ID generator; ignored when an external eventStore is provided
}

function createSSEChannel<TSignal extends InvalidateSignal = InvalidateSignal>(
  options?: SSEChannelOptions<TSignal>
): SSEChannel<TSignal>
```

`invalidate()` returns the event ID assigned to the frame (the `customId` if provided, or the
auto-generated ID from the `eventStore`, or `''` when no ID is assigned).

When `signalSchema` is provided, `invalidate()` validates each signal (unwrapping arrays) via
`signalSchema['~standard'].validate(signal)` before framing. If the result contains `issues`,
`invalidate()` throws `SchemaValidationError`. If the result is a `Promise`, `invalidate()` throws
`SchemaValidationError` with message `"async schemas are not supported"` — the channel lifecycle
is synchronous.

When `signalSchema` is omitted, `invalidate()` frames the signal as-is with no validation overhead
(identical to the current behavior). The generic defaults to `InvalidateSignal`, so existing code
that doesn't pass a schema compiles unchanged.

#### Event history and replay

When `eventStore` is provided (or `eventBufferCapacity > 0` is set, which auto-creates one),
every `invalidate()` call records the signal in the store with a unique event ID. The SSE frame
includes an `id:` field so that `EventSource` tracks the `Last-Event-ID`.

On reconnect, if the transport adapter extracts a `lastEventId` from the incoming request's
`Last-Event-ID` header, the channel replays all events stored after that ID into the stream
before starting keepalives. If the `lastEventId` is not found in the store (e.g., it fell off
the ring buffer), all currently stored events are replayed.

The default `EventStore` is an in-memory bounded ring buffer (default capacity: 100).

`core` handles SSE framing and keepalives. It does not detect disconnects or set response headers —
that's the transport adapter's job.

#### Channel lifecycle state machine

```text
  ┌─────────────────────────┐
  │       [open]            │
  │                         │
  │  invalidate() → ok      │
  │  close() → transition   │
  │  disconnect() → trans   │
  └────────┬────────────────┘
           │ close() or disconnect()
           ▼
  ┌─────────────────────────┐
  │      [closed]           │
  │                         │
  │  invalidate() → throws  │
  │  close() → no-op        │
  │  disconnect() → no-op   │
  └─────────────────────────┘
```

**Rules:**

| Method | State: `open` (no schema) | State: `open` (with schema) | State: `closed` |
|---|---|---|---|
| `invalidate(signal)` | Enqueues the SSE frame into the stream; returns event ID | Validates first → frames on success, throws `SchemaValidationError` on failure; returns event ID on success | Throws `ChannelClosedError` |
| `close()` | Stops keepalive timer, closes the `ReadableStream` controller, transitions to `closed` | Same | No-op |
| `disconnect()` | Same as `close()` — called by transport when peer disconnects | Same | No-op |

`ChannelClosedError` is checked **before** schema validation — no point validating a signal that
can't be sent.

`invalidate()` throws rather than silently dropping the signal, because a dropped signal means the
client's cache is now silently wrong. The caller should know.

#### `ChannelClosedError`

```ts
class ChannelClosedError extends Error {
  readonly name = 'ChannelClosedError'
}
```

#### `SchemaValidationError`

```ts
class SchemaValidationError extends Error {
  readonly name = 'SchemaValidationError'
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>
  constructor(issues: ReadonlyArray<StandardSchemaV1.Issue>)
}
```

Thrown by `invalidate()` when a signal fails schema validation. Contains both a formatted
`message` string and the original `issues` array for programmatic access.

#### `SSEChannelGroup`

```ts
class SSEChannelGroup<TSignal extends InvalidateSignal = InvalidateSignal, TMeta = unknown> {
  constructor(options?: {
    metaSchema?: StandardSchemaV1<unknown, TMeta>
    pubsub?: PubSubAdapter<TSignal>
    eventStore?: EventStore<TSignal>
    eventBufferCapacity?: number              // auto-creates an EventStore with this capacity
    controlTopic?: string                     // default '__restale_control__'
  })

  /** Number of active channels in the group */
  readonly size: number

  /** The pub/sub control topic name used for cross-cluster revocations. */
  readonly controlTopic: string

  /** The event store, if one was provided or auto-created via eventBufferCapacity. */
  readonly eventStore?: EventStore<TSignal>

  /**
   * Registers a channel with its associated metadata and optional routing topics.
   * If metaSchema was provided, validates metadata synchronously.
   * Throws SchemaValidationError if validation fails or is asynchronous.
   */
  register(channel: SSEChannel<TSignal>, meta: TMeta, options?: { topics?: string[] }): void

  /** Deregisters a channel from the group */
  deregister(channel: SSEChannel<TSignal>): void

  /**
   * Broadcasts to channels matching the predicate.
   * If a channel throws ChannelClosedError, it is automatically deregistered.
   * Non-ChannelClosedError errors (e.g. SchemaValidationError) are collected across all
   * channels and thrown as an AggregateError at the end — iteration always completes.
   */
  broadcast(signal: TSignal | TSignal[], predicate: (meta: TMeta) => boolean): void

  /**
   * Explicitly broadcasts to ALL channels in the group.
   * If a channel throws ChannelClosedError, it is automatically deregistered.
   * Non-ChannelClosedError errors are collected and thrown as AggregateError at the end.
   */
  broadcastToAll(signal: TSignal | TSignal[]): void

  /**
   * Broadcasts to channels whose metadata matches the signal's key using the
   * same hierarchical prefix/exact matching semantics as the wire protocol.
   * Eliminates the need to write manual predicate functions for key-based routing.
   */
  broadcastByKey(signal: TSignal): void

  /**
   * Publishes a signal to a topic.
   * 1. Delivers to any locally-held channels registered on that topic.
   * 2. If a pub/sub adapter is configured, also publishes to the broker.
   *
   * Unlike broadcast(), delivery errors to individual channels are logged
   * but not thrown — publish() only propagates errors from the broker publish call.
   */
  publish(topic: string, signal: TSignal | TSignal[]): Promise<void>

  /**
   * Revokes all channels whose registered metadata subset-matches `criteria`.
   * 1. Closes and deregisters matching local channels immediately.
   * 2. If a pub/sub adapter is configured, publishes the revocation criteria to
   *    controlTopic so other instances can close their matching local channels.
   * Returns { localClosed } — the number of local channels closed.
   *
   * Note: channels registered without metadata cannot be matched and are skipped.
   * Use revokeByConnectionId(connectionId) to revoke those channels instead.
   */
  revokeWhere(criteria: JSONValue): Promise<{ localClosed: number }>

  /**
   * Revokes the single channel identified by connectionId.
   * Pass `scope` (a partial metadata object) to verify ownership before closing.
   * If the channel's metadata does not match `scope`, nothing is closed.
   * If a pub/sub adapter is configured, broadcasts a control message to the cluster.
   * Returns { closed: boolean }.
   */
  revokeByConnectionId(connectionId: string, scope?: Record<string, JSONValue>): Promise<{ closed: boolean }>

  /**
   * Tears down the control topic subscription idempotently.
   * Does NOT close registered client channels.
   * Call during graceful server shutdown.
   */
  dispose(): Promise<void>
}
```

This class acts as a native connection manager in `core`. Callers are encouraged to use `broadcast()`
with a predicate to narrow invalidations. To send to all channels unconditionally, the caller must
opt in explicitly via `broadcastToAll()`.

When a `metaSchema` is provided in the constructor, `register()` validates the `meta` object using
`metaSchema['~standard'].validate(meta)` before adding the channel. If validation fails, it throws a
`SchemaValidationError` containing the issues. If validation returns a `Promise`, it throws a
`SchemaValidationError` with the message `"async schemas are not supported"` since registration is
synchronous.

`SSEChannelGroup` is exported from `restale-kit/server`; shared errors are exported from
`restale-kit`.

#### Backpressure

v1: unbounded internal buffer. If the client can't consume fast enough, frames accumulate in the
`ReadableStream`'s internal queue. This is acceptable for the expected payload sizes (small JSON
objects at low frequency). A future version may add a `maxBufferSize` option with a configurable
overflow strategy.

---

### `restale-kit/node`, `restale-kit/express`, and `restale-kit/fastify`

```ts
function attachSSE<TSignal extends InvalidateSignal = InvalidateSignal>(
  req: IncomingMessage,
  res: ServerResponse,
  options?: SSEChannelOptions<TSignal>
): { channel: SSEChannel<TSignal>; connectionId: string }
```

Extracts the `__restale_cid__` query parameter from the request URL and returns it as
`connectionId`. Throws synchronously if the parameter is missing or empty — a channel registered
without a `connectionId` cannot be revoked with per-connection precision.

Sets SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`,
`Connection: keep-alive`), pipes `channel.stream` into `res` via
`Readable.fromWeb(channel.stream).pipe(res)`, wires `req.on('close', channel.disconnect)`.

Extracts the `Last-Event-ID` header from the request and passes it to `createSSEChannel` for
event replay (when an `eventStore` is configured).

For Fastify: pass `request.raw` / `reply.raw`, and call `reply.hijack()` first — otherwise Fastify
sends its own response on top of the streamed one and throws.

### `restale-kit/fetch` and `restale-kit/hono`

```ts
function toSSEResponse<TSignal extends InvalidateSignal = InvalidateSignal>(
  request: Request,
  options?: SSEChannelOptions<TSignal>
): { response: Response; channel: SSEChannel<TSignal>; connectionId: string }
```

Extracts `connectionId` from the `__restale_cid__` query parameter and `Last-Event-ID` from
request headers. Throws synchronously if the query parameter is missing.

Constructs `new Response(channel.stream, { headers })`, wires
`request.signal.addEventListener('abort', channel.disconnect)`. Returns a `Response` for the
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

### `restale-kit/client`

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

interface ClientOptions<TSignal extends InvalidateSignal = InvalidateSignal> {
  autoReconnect?: boolean   // default true
  reconnect?: ReconnectOptions
  signalSchema?: StandardSchemaV1<unknown, TSignal>  // optional — no schema = no validation
  withCredentials?: boolean  // default false — include cookies/credentials in the EventSource request
}

interface SSEInvalidatorClientEventMap<TSignal extends InvalidateSignal> {
  invalidate: CustomEvent<TSignal | TSignal[]>
  statuschange: CustomEvent<ConnectionStatus>
  error: CustomEvent<Event>
}

class SSEInvalidatorClient<TSignal extends InvalidateSignal = InvalidateSignal> extends EventTarget {
  constructor(url: string, opts?: ClientOptions<TSignal>)
  get status(): ConnectionStatus
  connect(): Promise<void>   // resolves when open; rejects with the error Event if it fails first
  close(): void               // reason 'manual'; connect() can reopen

  addEventListener<K extends keyof SSEInvalidatorClientEventMap<TSignal>>(
    type: K,
    listener: (this: SSEInvalidatorClient<TSignal>, ev: SSEInvalidatorClientEventMap<TSignal>[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void

  removeEventListener<K extends keyof SSEInvalidatorClientEventMap<TSignal>>(
    type: K,
    listener: (this: SSEInvalidatorClient<TSignal>, ev: SSEInvalidatorClientEventMap<TSignal>[K]) => any,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void
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

**Validation pipeline:**

1. `JSON.parse` must succeed — otherwise error.
2. Result must be a plain object, or an array of plain objects — otherwise error.
3. Each object must have a `key` property that is an `Array` — otherwise error.
4. If `exact` is present, it must be `boolean` — otherwise error.
5. If `action` is present, it must be one of `'invalidate' | 'refetch' | 'remove'` — otherwise error.
6. **Extra unknown fields are ignored** — forward-compatible. A future protocol version can add
   optional fields without breaking existing clients.
7. If `signalSchema` is provided: for each signal in the batch, call
   `signalSchema['~standard'].validate(signal)`. If the result is a `Promise`, emit error
   (`"async schemas are not supported"`). If `result.issues` is truthy, emit error
   (`SchemaValidationError`). Otherwise use `result.value` as the typed output.
8. Emit `'invalidate'` event with the validated, typed payload.

Steps 1–6 (built-in structural validation) run **before** the user's schema (step 7). This means
the schema can assume it's receiving a structurally valid `InvalidateSignal` and only needs to
narrow the type further (e.g., constrain `key` to specific shapes).

---

### `restale-kit/react`

```ts
interface UseReStaleOptions<TSignal extends InvalidateSignal = InvalidateSignal>
  extends ClientOptions<TSignal> {
  disabled?: boolean
  onInvalidate: (signal: TSignal | TSignal[]) => void   // ← typed by schema
}

interface UseReStaleResult {
  connectionId: string            // unique ID for this SSE connection instance
  connection: ConnectionStatus
  reconnect(): Promise<void>
  close(): void
}

function useReStale<TSignal extends InvalidateSignal = InvalidateSignal>(
  url: string,
  opts: UseReStaleOptions<TSignal>
): UseReStaleResult
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
function tanstackAdapter<TSignal extends InvalidateSignal = InvalidateSignal>(
  queryClient: QueryClient
): (signal: TSignal | TSignal[]) => void {
  return (signal) => {
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
`client` wrapper in this same shape — not a change to the direct client implementation.

---

## Exported type surface

Each subpath export has a defined public API. Only these symbols are exported:

| Subpath | Exported symbols |
|---|---|
| `restale-kit` | `JSONValue`, `InvalidateSignal`, `SSEInvalidateEvent`, `ChannelState`, shared errors and schema helpers |
| `restale-kit/server` | `createSSEChannel`, `SSEChannel`, `SSEChannelOptions`, `SSEChannelGroup`, `createEventStore`, `EventStoreOptions` |
| `restale-kit/node`, `restale-kit/express`, `restale-kit/fastify` | `attachSSE` |
| `restale-kit/fetch`, `restale-kit/hono` | `toSSEResponse` |
| `restale-kit/client` | `SSEInvalidatorClient`, `ClientOptions`, `ReconnectOptions`, `ConnectionStatus` |
| `restale-kit/react` | `useReStale`, `UseReStaleOptions`, `UseReStaleResult`, `ConnectionStatus` |
| `restale-kit/tanstack-query` | `tanstackAdapter` |
| `restale-kit/swr` | `swrAdapter` |
| `restale-kit/pubsub` | `PubSubAdapter` |
| `restale-kit/{redis,ably,pusher}` | provider-specific PubSub adapters |

`InvalidateSignal` is available from `restale-kit` and re-exported from `restale-kit/client`
for direct client users.

`StandardSchemaV1` is **not** re-exported — the type interface is inlined in the library's source
(per the [Standard Schema spec's recommendation](https://github.com/standard-schema/standard-schema)).
Users import schema constructors from their own library (Zod, Valibot, ArkType, etc.).

---

## Multi-channel broadcasting

The library provides `SSEChannelGroup` to manage client connections on the server side. It manages
registering and deregistering channels, automatically cleans up closed connections during
transmissions, and encourages/compels callers to scope their invalidations.

### The Broadcasting API

```ts
// Application defines its own metadata shape
interface ClientMeta {
  userId: string
  roles: string[]
}

import { attachSSE } from 'restale-kit/express'
import { SSEChannelGroup } from 'restale-kit/server'

// Create a group typed with your metadata
const group = new SSEChannelGroup<InvalidateSignal, ClientMeta>()

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  
  // Register the channel in the group — auto-deregisters on disconnect
  group.register(channel, { userId: req.user.id, roles: req.user.roles })
})
```

### Scoped broadcast (Preferred)

To prevent accidental data leakage, callers should utilize `group.broadcast()`. It requires
a predicate function to specify exactly which channels receive the signals.

```ts
// Only invalidate todos for user 123
group.broadcast(
  { key: ['todos', { userId: '123' }], exact: true },
  (meta) => meta.userId === '123'
)

// Invalidate all admin data for admin users
group.broadcast(
  { key: ['admin-data'] },
  (meta) => meta.roles.includes('admin')
)
```

### Unconditional broadcast (Explicit opt-in)

If the signal truly concerns every connected client (e.g., global configuration updates or
system-wide invalidation), callers can explicitly use `broadcastToAll()`. This forces the caller
to consciously choose a blanket broadcast.

```ts
// Invalidate system configuration for everyone
group.broadcastToAll({ key: ['config'] })
```

### What the library guarantees vs. what is userland

| Concern | Where it lives |
|---|---|
| SSE framing, keepalives, channel lifecycle | `core` (`SSEChannel`) |
| Per-channel disconnect detection | transport adapter (`/node`, `/fetch`) |
| Grouping channels, clean-ups, broadcast loops | `core` (`SSEChannelGroup`) |
| Defining identity metadata structure | **userland** |
| Auth, session identity, roles | **userland** (never touches `core`) |

The predicate in `broadcast` is evaluated synchronously against the registered metadata.
If `channel.invalidate()` throws `ChannelClosedError` during transmission, the group catches it,
removes the channel internally, and continues broadcasting to the next channel in the group.
All other errors (e.g. `SchemaValidationError`) are collected across all channels; once iteration
completes, they are thrown as a single `AggregateError`. The errored channels are **not**
deregistered — they remain in the group and may succeed on a subsequent broadcast.

---

## Standard Schema integration

To ensure runtime type safety and encourage best practices, the library natively accepts
[Standard Schema](https://github.com/standard-schema/standard-schema)-compatible validation schemas
(like Zod, Valibot, ArkType, etc.) at its API boundaries.

Providing a schema is **optional**. If no schema is passed, the API falls back to the default
`InvalidateSignal` type with no runtime schema validation overhead.

### The Standard Schema interface (inlined)

To avoid external dependency issues, the library inlines the standard interface:

```ts
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
      options?: { libraryOptions?: Record<string, unknown> }
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
  };
}

declare namespace StandardSchemaV1 {
  type Result<Output> = SuccessResult<Output> | FailureResult;
  interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
  }
}
```

### Server-side validation with Zod

By providing a schema to `attachSSE` or `toSSEResponse`, the channel is typed with the inferred
schema output, and all inputs to `channel.invalidate()` are validated at runtime. Using
`SSEChannelGroup` with a metadata schema validation allows enforcing connection metadata types at the
same time:

```ts
import { z } from 'zod'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/fastify'

// Define schema for valid application signals
const TodoSignalSchema = z.object({
  key: z.tuple([z.literal('todos'), z.object({ userId: z.string() })]),
  exact: z.literal(true).optional(),
  action: z.enum(['invalidate', 'refetch', 'remove']).optional(),
})

type TodoSignal = z.infer<typeof TodoSignalSchema>

// Define schema for connection metadata
const ClientMetaSchema = z.object({
  userId: z.string(),
})

type ClientMeta = z.infer<typeof ClientMetaSchema>

// Create group validating both signals and connection metadata
const group = new SSEChannelGroup<TodoSignal, ClientMeta>({
  metaSchema: ClientMetaSchema,
})

app.get('/sse', (req, res) => {
  // Pass schema to attachSSE to enforce it on the channel
  const channel = attachSSE(req, res, { signalSchema: TodoSignalSchema })
  
  // Validated synchronously upon registration; throws SchemaValidationError if invalid
  group.register(channel, { userId: req.user.id })
  
  // Enforces type safety at compile time:
  channel.invalidate({ key: ['todos', { userId: '123' }] }) // ✅ Valid type
  // channel.invalidate({ key: ['posts'] }) // ❌ TypeScript compilation error
})
```

At runtime, `channel.invalidate()` validates the signal against `TodoSignalSchema`.
- If validation succeeds, the signal is framed and sent.
- If validation fails, it throws a `SchemaValidationError`.
- If the schema contains asynchronous validation logic (which returns a `Promise`), the call
  throws a `SchemaValidationError` with the message `"async schemas are not supported"` since
  SSE transmission is synchronous.

### Client-side validation with Zod

Similarly, providing a schema on the client restricts the events received by the cache adapter and
ensures untrusted wire events match the expected structure:

```ts
import { z } from 'zod'
import { useReStale } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'

const AppSignalSchema = z.object({
  key: z.array(z.unknown()),
  exact: z.boolean().optional(),
  action: z.enum(['invalidate', 'refetch', 'remove']).optional(),
})

function App() {
  const queryClient = useQueryClient()

  // Hook inherits the schema's type
  useReStale('/sse', {
    signalSchema: AppSignalSchema,
    onInvalidate: tanstackAdapter(queryClient) // ✅ Safely typed callback
  })
}
```

---

## What this library does not do

- Auth, session scoping, CORS
- Event filtering or routing
- Guaranteed at-least-once delivery — event replay (via `EventStore`) is best-effort from a
  bounded in-memory ring buffer; events that fall off the buffer before a client reconnects are lost
- Any query fetching, caching, or state management beyond calling into the chosen adapter
