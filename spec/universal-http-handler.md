# Universal HTTP Route Handler (`group.handle()`)

## Overview

Historically, setting up an SSE stream with client context synchronization required configuring two separate HTTP routes with framework-specific glue code:
1. `GET /sse` — to establish the streaming response via `attachNodeResponse` or `createFetchResponse`.
2. `POST /sse` — to receive client context updates (`page`, `filters`, `sortBy`), parse the JSON body, verify session authorization, and invoke `updateClientContext`.

**`group.handle()`** collapses this entire setup into a **single, universal, framework-agnostic route handler**. It automatically detects the runtime environment, routes `GET`, `POST`, and `OPTIONS` requests, validates cryptographic signatures and schemas, handles CORS preflight, and returns standardized responses.

---

## Universal API Signature

`group.handle()` uses polymorphic runtime detection to support both **Node.js runtimes** (Express, Fastify, NestJS, Node `http`) and **Web Standard Fetch API runtimes** (Next.js App Router, Bun, Deno, Cloudflare Workers, Hono, Remix, SvelteKit, Astro).

```ts
export interface ChannelSetupOptions<TMeta = unknown> extends SSEChannelOptions {
  meta?: TMeta
  topics?: string[]
}

// 1. Node.js Runtimes (Express, Fastify, Node http)
function handle(
  req: NodeRequestLike,
  res: NodeResponseLike,
  options?: ChannelSetupOptions<TMeta>
): Promise<void>

// 2. Fetch API / Web Standard Runtimes (Next.js, Bun, Deno, Cloudflare, Hono)
function handle(
  request: Request,
  options?: ChannelSetupOptions<TMeta>
): Promise<Response>
```

---

## Internal Request Routing & Execution Flow

```text
Incoming HTTP Request -> group.handle(req, [res], options)
        │
        ├── IF Method === 'GET':
        │     ├── Establishes SSE stream (Content-Type: text/event-stream)
        │     ├── Subscribes channel to configured `topics` (if provided)
        │     ├── Emits 'connected' frame with cryptographically signed token
        │     ├── Replays missed events if 'Last-Event-ID' header is present
        │     └── Wires up keepalive timers, lifetime limits, and disconnect cleanup
        │
        ├── IF Method === 'POST':
        │     ├── Reads body: expects pre-parsed `req.body` in Node or calls `await request.json()` in Fetch
        │     │     └── IF req.body missing in Node -> HTTP 500 Internal Server Error (misconfiguration)
        │     ├── Validates purpose === 'CLIENT_CONTEXT'
        │     ├── Cryptographically verifies connection token against request `meta` (using `scopeBy`)
        │     ├── Validates `clientContext` against configured `clientContextSchema`
        │     ├── Updates in-memory context and syncs across cluster control topic
        │     ├── (Note: `topics` in options is safely ignored during POST)
        │     └── Returns HTTP 200 OK {"ok":true}
        │
        ├── IF Method === 'OPTIONS':
        │     └── Returns HTTP 204 No Content with standard CORS preflight headers
        │
        └── ANY OTHER METHOD (PUT, DELETE, PATCH):
              └── Returns HTTP 405 Method Not Allowed with 'Allow: GET, POST, OPTIONS'
```

---

## CORS & `OPTIONS` Preflight Handling

When a browser client updates its query context via `POST /sse`, it sends a `Content-Type: application/json` header, causing browsers to issue an **`OPTIONS` preflight request**.

`group.handle()` handles preflight method and header negotiation automatically:
* Responds with **`204 No Content`**.
* Sets headers:
  * `Allow: GET, POST, OPTIONS`
  * `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  * `Access-Control-Allow-Headers: Content-Type, Last-Event-ID, Cache-Control`
  * `Access-Control-Max-Age: 86400`
* **Cross-Origin & Credentials Requirements:** `group.handle()` intentionally omits `Access-Control-Allow-Origin` so applications retain full authority over origin allowlists. Application CORS middleware (e.g. `cors({ origin: 'https://app.example.com', credentials: true })`) must supply `Access-Control-Allow-Origin` for cross-origin requests. For credentialed requests (`withCredentials: true` or cookie auth), CORS requires an explicit allowed origin rather than wildcard `*` along with `Access-Control-Allow-Credentials: true`.
* **Compatibility:** If the application already has global CORS middleware (e.g. `app.use(cors())`), the middleware intercepts the request before `group.handle()` is reached. If not, `group.handle()` provides default method/header negotiation for same-origin and reverse-proxied setups.

---

## Body Parsing Requirements

* **Fetch API Runtimes (Next.js, Hono, Bun, Deno, Cloudflare):** Handled automatically via standard `await request.json()`.
* **Fastify:** Handled automatically via Fastify's built-in JSON body parser. Fastify wrapped `(request, reply)` objects are detected natively, and SSE streaming uses Fastify's `reply.send(stream)` pipeline without socket hijacking.
* **Express / Node.js HTTP:** Requires JSON middleware (e.g. `app.use(express.json())`). If `req.body` is `undefined` on `POST`, `group.handle()` returns `500 Internal Server Error` with diagnostic message:
  `"[restale] Request body is missing on POST /sse. Ensure JSON body-parser middleware (e.g. express.json()) is mounted before group.handle()."`

---

## HTTP Status Codes & Error Handling Matrix

When handling `POST /sse` context updates, `group.handle()` handles all validations and error statuses automatically:

| Status Code | Reason | Cause |
| :--- | :--- | :--- |
| **`200 OK`** | Context Updated | Context was successfully validated, signature verified, and applied locally or dispatched across cluster (`{"ok":true}`). |
| **`204 No Content`** | Preflight | `OPTIONS` preflight response. |
| **`400 Bad Request`** | Malformed Payload | Body is not valid JSON, `purpose` is not `'CLIENT_CONTEXT'`, or `revision` is invalid. |
| **`403 Forbidden`** | Signature / Auth Mismatch | Connection token HMAC signature failed or caller's authenticated `meta` does not match the token's embedded identity. |
| **`405 Method Not Allowed`** | Unsupported Method | Request method was not `GET`, `POST`, or `OPTIONS`. |
| **`422 Unprocessable Entity`** | Schema Validation Failed | `clientContext` failed validation against the group's `clientContextSchema` (returns JSON error details). |
| **`500 Internal Server Error`** | Server Misconfiguration | Node.js `req.body` is `undefined` because body parser middleware was omitted. |

---

## Framework Integration Examples

### 1. Express & Node.js `http`

```ts
import express from 'express'
import { group } from './restale.js'
import { authenticate } from './auth.js'

const app = express()
app.use(express.json()) // Required for POST /sse body parsing
app.use(authenticate) // Attaches req.user

// Single universal route for both SSE stream and context updates:
app.all('/sse', (req, res) => {
  return group.handle(req, res, {
    meta: { userId: req.user.id, teamId: req.user.teamId },
    topics: [`team:${req.user.teamId}`, `user:${req.user.id}`],
  })
})
```

---

### 2. Next.js App Router (`app/api/sse/route.ts`)

```ts
import { group } from '@/lib/restale'
import { getSession } from '@/lib/auth'

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return new Response('Unauthorized', { status: 401 })

  return group.handle(req, {
    meta: { userId: session.userId, teamId: session.teamId },
    topics: [`team:${session.teamId}`, `user:${session.userId}`],
  })
}

export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return new Response('Unauthorized', { status: 401 })

  return group.handle(req, {
    meta: { userId: session.userId, teamId: session.teamId },
  })
}

export async function OPTIONS(req: Request) {
  return group.handle(req)
}
```

---

### 3. Fastify

```ts
import Fastify from 'fastify'
import { group } from './restale.js'
import { authenticate } from './auth.js'

const app = Fastify()

app.all('/sse', async (request, reply) => {
  await authenticate(request)
  return group.handle(request, reply, {
    meta: { userId: request.user.id, teamId: request.user.teamId },
    topics: [`team:${request.user.teamId}`],
  })
})
```

---

### 4. Hono (Bun, Deno, Cloudflare Workers, Node)

```ts
import { Hono } from 'hono'
import { group } from './restale.js'
import { authMiddleware } from './auth.js'

const app = new Hono()
app.use('/sse', authMiddleware)

app.all('/sse', (c) => {
  return group.handle(c.req.raw, {
    meta: { userId: c.get('userId'), teamId: c.get('teamId') },
    topics: [`team:${c.get('teamId')}`],
  })
})
```

---

## Benefits

1. **Zero Boilerplate:** Replaces ~40 lines of manual body parsing, status code switching, and header formatting with a single one-liner.
2. **Unified Security:** HMAC signature verification and `clientContextSchema` checks run automatically before any internal state is touched.
3. **Automatic Preflight:** Handles `OPTIONS` seamlessly without requiring CORS plugins for basic setups.
4. **Cross-Platform Portability:** Writing server route handlers looks identical whether targeting Express, Next.js, Fastify, or Cloudflare Workers.
