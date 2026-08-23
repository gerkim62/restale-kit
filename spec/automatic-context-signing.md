# Automatic Client Context Scoping & Trusted Connection Tokens

## Overview

ReStale allows clients to update their UI query parameters dynamically (e.g., page, sort order, active filters) via **Client Context**, and allows servers to revoke individual client connections on logout or session expiration. 

Because connection operations occur over standard HTTP, the server must ensure that an attacker cannot spoof or tamper with another user's `connectionId`.

By requiring a **`secret`** on `SSEChannelGroup`, ReStale cryptographically binds the `connectionId` to the authenticated user's metadata (`meta`). This guarantees that connection IDs are **tamper-proof, cryptographically signed tokens across all web frameworks and JavaScript runtimes**.

---

## What `secret` Solves

| Operation | Without `secret` (Bare UUIDs) | With `secret` (Cryptographically Signed Tokens) |
| :--- | :--- | :--- |
| **HTTP Route Handler** | Developer had to write separate `GET /sse` and `POST /sse` boilerplate. | **One Universal Handler:** `group.handle()` automatically handles both `GET` and `POST` across all frameworks. |
| **`POST /sse` (Client Context)** | Developer had to manually parse body, extract `userId`, and verify match. | **100% Automated:** `group.handle()` automatically verifies HMAC signatures against the authenticated session. |
| **`revokeByConnectionId(id, scope)`** | Untrusted string IDs could be forged or guessed. | **Cryptographically Verified:** Token signature is verified against the caller's scoped session (`scope`) before closing or broadcasting across the cluster. |
| **Security Footguns** | Forgetting validation risked session hijacking and spoofing. | **Zero Footguns:** Cryptographic verification is enforced automatically under the hood. |

---

## How It Works: HMAC-SHA256 Token Binding

When a connection is established, the server emits a **cryptographically signed connection token**:

$$\text{Token} = \text{rawUUID} \mathbin{\Vert} \text{"."} \mathbin{\Vert} \text{HMAC-SHA256}(\text{Secret}, \text{rawUUID} + \text{CanonicalJSON}(\text{ScopedMeta}))$$

```
Wire Connection Token:
"d290f1ee-6c54-4b01-90e6-d701748f0851.e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

### Complete End-to-End Flow with `group.handle()`

```text
[Browser Client]                                    [Universal group.handle() Route]
       │                                                           │
       ├─ 1. GET /sse (Auth Cookie / Session) ────────────────────►│ Auth middleware -> meta = { userId: "42" }
       │                                                           │ Creates raw UUID
       │                                                           │ Signs: sig = HMAC(secret, rawUUID + scopedMeta)
       │◄─ 2. event: connected {"connectionId": token} ────────────┤ Emits token: "rawUUID.sig"
       │                                                           │
       │                                                           │ (User changes page/filters in UI)
       │                                                           │
       ├─ 3. POST /sse { connectionId: token, ctx } ──────────────►│ Auth middleware -> postMeta = { userId: "42" }
       │                                                           │ Splits token into rawUUID & sig
       │                                                           │ Recomputes: expectedSig = HMAC(secret, rawUUID + scopedPostMeta)
       │                                                           │
       │                                                           │ IF sig === expectedSig:
       │                                                           │    ✅ Updates context for rawUUID & syncs to cluster
       │                                                           │ ELSE (Attacker using victim's token):
       │◄─ 4. HTTP 200 OK (or 403 Forbidden on fail) ──────────────┤    ❌ 403 Forbidden!
```

---

## The Dynamic Metadata Hazard & `scopeBy`

In production apps, session objects often contain dynamic properties (e.g. timestamps, request IDs, IP addresses):
```ts
// On GET /sse (12:00:00)
meta: { userId: "42", lastSeen: 1720000000 }

// On POST /sse (12:05:00 - session middleware refreshed lastSeen!)
meta: { userId: "42", lastSeen: 1720000300 }
```

If the entire `meta` object were signed, the signature check on `POST` would fail because `lastSeen` changed.

### The Solution: Strictly Typed `scopeBy`
ReStale enforces `scopeBy` whenever `TMeta` is defined. The HMAC token binds **only the stable identity attributes**:
```ts
const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET!,
  scopeBy: ['userId'], // Only signs userId; lastSeen changes will NOT break signatures!
})
```

For unauthenticated applications (`TMeta = undefined`), `scopeBy` is optional, and the token signs the raw UUID with `secret`.

---

## Universal Runtime Support via Web Crypto

To ensure 100% compatibility across **all runtimes with zero external dependencies**, ReStale uses the standard W3C Web Crypto API (`globalThis.crypto.subtle`):

* **Node.js:** 18+ (Express, Fastify, NestJS, native `http`)
* **Fetch API Runtimes:** Bun, Deno, Cloudflare Workers, Edge Runtimes
* **Full-stack Frameworks:** Next.js (App Router & Pages Router), Remix, SvelteKit, Astro, Hono

---

## Framework Integration Examples

With `secret`, `scopeBy`, and `group.handle()`, setting up your SSE and Context Sync endpoint is a clean one-liner across any framework.

### 1. Express / Node.js HTTP

```ts
import express from 'express'
import { group } from './restale.js'
import { authenticate } from './auth.js'

const app = express()
app.use(express.json()) // Required for POST /sse body parsing
app.use(authenticate) // Populates req.user

// Single universal route: handles both GET stream and POST context updates!
app.all('/sse', (req, res) => {
  return group.handle(req, res, {
    meta: { userId: req.user.id, teamId: req.user.teamId },
    topics: [`team:${req.user.teamId}`],
  })
})

// LOGOUT: Revocation by connection ID with strictly typed scope
app.post('/api/logout', (req, res) => {
  if (req.body.connectionId) {
    group.local.revokeByConnectionId(req.body.connectionId, { userId: req.user.id })
  } else {
    group.local.revokeWhere({ userId: req.user.id })
  }
  res.json({ ok: true })
})
```

### 2. Next.js App Router (`app/api/sse/route.ts`)

```ts
import { group } from '@/lib/restale'
import { getSession } from '@/lib/auth'

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return new Response('Unauthorized', { status: 401 })

  return group.handle(req, {
    meta: { userId: session.userId, teamId: session.teamId },
    topics: [`user:${session.userId}`, `team:${session.teamId}`],
  })
}

export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return new Response('Unauthorized', { status: 401 })

  return group.handle(req, {
    meta: { userId: session.userId, teamId: session.teamId },
  })
}
```

### 3. Fastify

```ts
import Fastify from 'fastify'
import { group } from './restale.js'

const app = Fastify()

app.all('/sse', async (request, reply) => {
  await authenticate(request)
  return group.handle(request, reply, {
    meta: { userId: request.user.id },
  })
})
```

---

## Security Guarantees & Threat Matrix

| Threat | Attack Vector | How ReStale Prevents It |
| :--- | :--- | :--- |
| **Token Forgery** | Attacker invents a random token string. | Rejected: HMAC signature validation fails without server secret. |
| **User Impersonation** | Attacker intercepts User A's token and sends it with User B's auth session. | Rejected: Signature is tied to User A's `userId`. Validating against User B's `meta` produces a signature mismatch $\rightarrow$ `403 Forbidden`. |
| **Token Tampering** | Attacker modifies the raw UUID or embedded identity inside the token. | Rejected: Any byte modification breaks the cryptographic digest. |
| **Unauthorized Revocation** | Attacker attempts to forge connection IDs to kick victims. | Rejected: Revoking by connection ID verifies the HMAC signature against the supplied `scope`. Invalid/tampered tokens return `{ closed: false }` without cluster propagation. |
| **Payload Injection** | Client sends malformed or malicious JSON fields in `clientContext`. | Rejected: Automatically validated against `clientContextSchema` $\rightarrow$ `422 Unprocessable Entity`. |
| **Timing Attacks** | Attacker uses timing analysis to brute-force signatures. | Protected: Verification uses constant-time comparison via Web Crypto. |

---

## Summary

1. **Set `secret`** on `SSEChannelGroup` constructor (required).
2. **Set `scopeBy: ['userId']`** to declare stable identity keys for HMAC binding.
3. **`group.handle()`** provides a universal one-liner for all frameworks handling both `GET` stream initialization and `POST` context updates.
4. **`revokeByConnectionId(connectionId, scope)`** verifies HMAC signatures with strictly typed scope before revoking.

