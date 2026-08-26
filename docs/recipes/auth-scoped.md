# Scoped Authentication Recipe

Cryptographically binding connection tokens to user identity with HMAC signatures via `scopeBy`.

---

## Implementation

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
