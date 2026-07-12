# sse-query-invalidate — contract document

## Purpose

A minimal library that lets a server tell TanStack Query to invalidate specific cache keys over a
persistent SSE connection. One job, done well.

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

```
@sse-query-invalidate/core           # wire protocol types + server-side SSE channel
@sse-query-invalidate/client-core    # connection state machine, reconnect, event emitting
@sse-query-invalidate/node           # Node http.IncomingMessage/ServerResponse transport (covers Express, Fastify)
@sse-query-invalidate/fetch          # WHATWG Request/Response transport (covers Hono, Bun, Deno, Workers, edge)
@sse-query-invalidate/react          # useSSEInvalidator hook
@sse-query-invalidate/tanstack-query # translates the wire signal into queryClient calls
```

Express and Fastify both sit on Node's `http` module, so both use `@sse-query-invalidate/node`
directly (Fastify needs `reply.hijack()` first — see below). Hono, Bun, Deno, and edge runtimes
speak `Request`/`Response`, so all of them use `@sse-query-invalidate/fetch`. No per-framework
server packages exist.

---

## Wire protocol

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

**Example payloads:**

```json
{ "key": ["todos"], "exact": false }
```

```json
[ { "key": ["todos"] }, { "key": ["todos-count"] } ]
```

**Why not `InvalidateQueryFilters` from `@tanstack/query-core`:** that type has an optional
`predicate: (query) => boolean` function field. `JSON.stringify` drops function values silently —
no error, just quietly wrong behavior for anyone who reuses an in-process filter object that
happens to have a predicate. `key: JSONValue[]` makes that class of bug impossible at the type
level, and as a side effect keeps `core` free of any TanStack import.

**`[]` as a key:** matches everything. Intentional — useful for "invalidate everything after a
deploy." Adapters must not guard against it; the sender is trusted to mean it.

**Serialization:** `JSON.stringify` / `JSON.parse`. Every field is a plain JSON type, so this is
lossless in both directions — no more silent loss of non-plain key values (`Date`, `Map`, class
instances) that don't survive the round trip.

**Event naming:** named SSE event `event: invalidate`, not the default `message` event, for clean
filtering.

**Keepalive:** periodic `: keepalive` comment lines prevent proxies/load balancers from dropping
idle connections. Interval configurable, default 30s.

---

## Server side

### `@sse-query-invalidate/core`

Runtime-agnostic. Produces a standard `ReadableStream<Uint8Array>` rather than writing into a
Node-specific response object — this is what lets the Fetch-API transport exist without forking the
protocol logic.

```ts
interface SSEChannel {
  stream: ReadableStream<Uint8Array>
  invalidate(signal: InvalidateSignal | InvalidateSignal[]): void
  close(): void
  notifyClosed(): void   // called by a transport adapter when it detects the peer disconnected
}

function createSSEChannel(options?: { keepaliveIntervalMs?: number }): SSEChannel
```

`core` handles SSE framing and keepalives. It does not detect disconnects or set response headers —
that's the transport adapter's job.

### `@sse-query-invalidate/node`

```ts
function attachSSE(req: IncomingMessage, res: ServerResponse, options?): SSEChannel
```

Sets SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`,
`Connection: keep-alive`), pipes `channel.stream` into `res` via
`Readable.fromWeb(channel.stream).pipe(res)`, wires `req.on('close', channel.notifyClosed)`.

For Fastify: pass `request.raw` / `reply.raw`, and call `reply.hijack()` first — otherwise Fastify
sends its own response on top of the streamed one and throws.

### `@sse-query-invalidate/fetch`

```ts
function toSSEResponse(request: Request, options?): { response: Response; channel: SSEChannel }
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

### `@sse-query-invalidate/client-core`

No UI framework, no cache library dependency.

```ts
type ConnectionStatus =
  | { status: 'connecting' }
  | { status: 'open' }
  | { status: 'closed'; reason: 'manual' | 'unmount' }
  | { status: 'error'; error: Event }

interface ClientOptions {
  autoReconnect?: boolean   // default true
  reconnect?: { baseDelayMs?: number; maxDelayMs?: number; jitter?: boolean }
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

Built on native `EventSource`. Reconnect uses exponential backoff with jitter when `autoReconnect`
is true (default); when false, the connection stays closed until `connect()` is called manually.
`connect()` is a no-op if already open.

Each parsed payload is checked to be a plain object (or array of them) with a `key: unknown[]`
field before being re-emitted as `invalidate`; a payload that fails this check emits `error`
instead, so a malformed server payload can't throw uncaught inside consuming code.

`connect()`'s internal promise is backed by one-shot `open`/`error` listeners, removed on `close()`
so a pending promise never resolves against a torn-down connection.

### `@sse-query-invalidate/react`

```ts
interface SSEQueryInvalidatorOptions extends ClientOptions {
  disabled?: boolean
  onInvalidate?: (signal: InvalidateSignal | InvalidateSignal[]) => void
}

interface SSEQueryInvalidatorResult {
  connection: ConnectionStatus
  reconnect(): Promise<void>
  close(): void
}

useSSEInvalidator(url: string, opts?: SSEQueryInvalidatorOptions): SSEQueryInvalidatorResult
```

Wraps `SSEInvalidatorClient` in a `useSyncExternalStore` subscription. Opens on mount unless
`disabled`. Closes with reason `'unmount'` on unmount. Knows nothing about queries or caches — it
only forwards `invalidate` events to `onInvalidate`.

### `@sse-query-invalidate/tanstack-query`

The one worked adapter, and the pattern to copy for any other cache library later:

```ts
function tanstackAdapter(queryClient: QueryClient) {
  return (signal: InvalidateSignal | InvalidateSignal[]) => {
    const list = Array.isArray(signal) ? signal : [signal]
    for (const s of list) {
      const filters = { queryKey: s.key, exact: s.exact }
      if (s.action === 'remove') queryClient.removeQueries(filters)
      else queryClient.invalidateQueries(filters)
    }
  }
}
```

Usage:

```ts
import { useSSEInvalidator } from '@sse-query-invalidate/react'
import { tanstackAdapter } from '@sse-query-invalidate/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'

const queryClient = useQueryClient()
useSSEInvalidator('/sse', { onInvalidate: tanstackAdapter(queryClient) })
```

Supporting a different cache library or UI framework later means writing one function or one
`client-core` wrapper in this same shape — not a change to `core` or `client-core`.

---

## What this library does not do

- Auth, session scoping, CORS
- Event filtering or routing
- Replaying missed events after a reconnect
- Any query fetching, caching, or state management beyond calling into the chosen adapter
