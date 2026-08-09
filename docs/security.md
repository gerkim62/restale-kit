# Security Guide

This document centralizes security patterns, authentication guidance, parameter handling, and transport security controls.

---

## 1. Authentication Patterns

### Why Query Parameter Tokens are Dangerous
Passing authentication tokens (JWTs, API keys, session tokens) in URL query parameters (e.g. `/api/sse?token=xyz`) exposes sensitive credentials to:
- Server access logs and reverse proxy logs (Nginx, Cloudflare, AWS ALB).
- Browser history and referrer headers.
- Shoulder surfing and URL copy-pasting.

### Recommended Pattern: HTTP-Only Cookies
Use HTTP-only, secure, SameSite cookies for SSE authentication. The browser sends HTTP-only cookies automatically during the SSE handshake.

To enable cross-origin cookie transmission, pass `withCredentials: true` on the client and configure server CORS middleware.

#### Client Setup (`App.tsx`)

```tsx
useReStale('/api/sse', {
  onInvalidate,
  withCredentials: true, // Sends cookies across origins
})
```

#### Server Setup (Express + Session Middleware)

```ts
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

const app = express()

app.use(cors({
  origin: 'https://app.example.com',
  credentials: true, // Permits cookie headers on CORS preflight & request
}))
app.use(cookieParser())

const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

app.get('/api/sse', (req, res) => {
  const sessionToken = req.cookies.session_token
  const user = authenticateSession(sessionToken)

  if (!user) {
    res.status(401).send('Unauthorized')
    return
  }

  group.attachNodeResponse(req, res, {
    meta: { userId: user.id, sessionId: user.sessionId },
  })
})
```

---

## 2. `connectionId` Security & Revocation

### Correlation ID vs. Authentication Credential
`connectionId` is a client-generated UUID appended automatically as `__restale_cid__` to correlate client stream instances.

> [!WARNING]
> **`connectionId` is NOT an authentication credential or secret.** Never use `connectionId` alone to verify user authorization or grant access.

### Secure Revocation Pattern
When executing connection revocation (e.g., closing a connection upon user logout or ban), always combine `connectionId` with server-authenticated metadata (`userId` or `sessionId`) derived from validated session state:

```ts
// Secure revocation combining connectionId with server-authoritative session state
await group.revokeWhere(
  (meta) => meta.userId === authenticatedUser.id && meta.sessionId === authenticatedUser.sessionId,
  'logout'
)
```

---

## 3. CORS Configuration

`restale-kit` sets protocol-specific response headers (`Content-Type`, `Cache-Control`, `Connection`, `X-ReStale-Target`, `X-ReStale-Supported`) but does **NOT** inject `Access-Control-Allow-Origin` or `Access-Control-Allow-Credentials` headers automatically.

You must configure CORS using your framework's standard middleware (e.g. `cors` for Express/Fastify, `cors()` for Hono). When using `withCredentials: true`, ensure `Access-Control-Allow-Credentials` is set to `true` and `Access-Control-Allow-Origin` specifies exact origins rather than wildcards (`*`).

---

## 4. Related Security Features

- **Pub/Sub Payload Encryption**: See [Pub/Sub Guide → Encryption](./pubsub.md#encryption).
- **Metadata Schema Validation (`metaSchema`)**: See [Validation Guide](./validation.md#2-metadata-validation-via-metaschema).
- **No Mixed-Mode Pub/Sub Clusters**: See [Pub/Sub Guide → Critical Security Constraints](./pubsub.md#critical-security-constraints).
