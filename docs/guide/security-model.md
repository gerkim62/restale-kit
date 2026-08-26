# Security Model & Threat Boundaries

ReStale Kit is designed from the ground up to prevent unauthorized cache spoofing, context manipulation, and cross-tenant leakage.

---

## 1. Cryptographic Secrets & HMAC Tokens

### Mandatory Secret
`new SSEChannelGroup({ secret: '...' })` strictly requires a non-empty cryptographic secret. The secret is used to generate HMAC-SHA256 signatures for connection tokens.

```ts
const group = new SSEChannelGroup({
  secret: process.env.RESTALE_SECRET!,
  scopeBy: ['userId'],
})
```

### Connection Token Format
When a client connects to GET `/api/sse`, the server assigns an opaque token in the format:
```
{rawUUID}.{hmacSignature}
```
The signature covers both the unique connection UUID and the scoped identity fields specified in `scopeBy`.

---

## 2. The `scopeBy` Mechanism

When clients send POST `/api/sse` to sync active query context, they must provide their connection token. The server recomputes the HMAC signature using the authenticated session metadata in `options.meta`.

If a malicious client attempts to use another user's connection ID to sync context or access data:
1. The server computes HMAC over the caller's session `userId`.
2. The signature fails verification because the token was signed with a different `userId`.
3. The server rejects the request with **HTTP 403 Forbidden**.

<!-- snippet:start auth-scoped -->
```ts
import { SSEChannelGroup } from 'restale-kit/server'

interface AuthSessionMeta {
  userId: string
  orgId: string
  role: 'admin' | 'member'
}

// Scoped SSEChannelGroup: HMAC token cryptographically binds connection to userId and orgId
const group = new SSEChannelGroup<AuthSessionMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  // Stable identity keys included in HMAC signature
  scopeBy: ['userId', 'orgId'],
})

export async function handleAuthenticatedSSE(
  request: Request,
  user: { id: string; organizationId: string; role: 'admin' | 'member' },
): Promise<Response> {
  return group.handle(request, {
    meta: {
      userId: user.id,
      orgId: user.organizationId,
      role: user.role,
    },
  })
}

export function invalidateOrgMembers(orgId: string) {
  group.local.broadcast(
    { key: ['organization', orgId, 'settings'] },
    (meta) => meta?.orgId === orgId,
  )
}
```
<!-- snippet:end -->

---

## 3. What `scopeBy` Does and Does Not Protect Against

### Protects Against:
- Connection token tampering.
- Cross-user client context hijacking.
- Unauthorized revocation via `revokeByConnectionId`.

### Does Not Replace:
- Server-side route authentication (e.g. session cookies, JWT middleware). You must still verify the user's session before calling `group.handle()`.
- Content authorization on query fetch endpoints.

---

## Doctest

```ts doctest:security_verification
import { SSEChannelGroup } from 'restale-kit/server'

expect(() => {
  // @ts-expect-error test empty secret throws
  new SSEChannelGroup({})
}).toThrow('[SSEChannelGroup] secret is required')
```
