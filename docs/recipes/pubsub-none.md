# Local In-Memory (No Pub/Sub) Recipe

Running single-pod or standalone applications with purely in-memory connections via `group.local.*`.

---

## Implementation

<!-- snippet:start pubsub-none -->
```ts
import { SSEChannelGroup } from 'restale-kit/server'

interface UserMeta {
  userId: string
  role: 'admin' | 'user'
}

// Single-instance / in-memory SSEChannelGroup without pub/sub
const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
})

// Local in-memory broadcasting to all or filtered connections
export function invalidateAdminsOnly() {
  const result = group.local.broadcast(
    { key: ['admin', 'dashboard'] },
    (meta) => meta?.role === 'admin',
  )
  console.log(`Delivered to ${result.sent} local admin connection(s)`)
}

// In-memory revocation
export function revokeUserConnections(userId: string) {
  const { revoked } = group.local.revokeWhere((meta) => meta?.userId === userId)
  console.log(`Revoked ${revoked} local connection(s)`)
}
```
<!-- snippet:end -->
