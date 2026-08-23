**"Why not?" — You are completely right!** There is no reason to force developers to deal with low-level `channel.revoke()` objects.

In real-world web apps, during a `POST /logout` or `POST /ban-user` request, your handler **does not have access to the raw `channel` object from the `/sse` stream anyway**. All your handler has is `req.user.id` or `req.body.connectionId`.

Having **`revokeWhere`** and **`revokeByConnectionId`** work for both `local` and `cluster` creates a unified, beautiful API:

---

### The Fully Unified Mental Model

| Category | `group.local.*` *(Current Process Only)* | `group.cluster.*` *(Entire Cluster via Broker)* |
| :--- | :--- | :--- |
| **1. Cache Invalidation** | `.broadcast(signal, predicate?)`<br/>`.broadcastToAll(signal)` | `.broadcast(topic, signal)` |
| **2. Direct Inline Data Push** | `.pushInlineData(payload, predicate?)`<br/>*(Zero topics needed; resolves local connections)* | `.pushInlineData(topic, payload)`<br/>*(Topic-routed across cluster to all resolvers)* |
| **3. Connection Revocation (Logout / Ban)** | **`.revokeWhere(predicate \| criteria)`**<br/>*(Closes matching local connections)*<br/><br/>**`.revokeByConnectionId(id, scope?)`**<br/>*(Closes local connection matching ID)* | **`.revokeWhere(criteria)`**<br/>*(Closes matching connections cluster-wide)*<br/><br/>**`.revokeByConnectionId(id, scope)`**<br/>*(Closes connection across the cluster)* |

---

### Why this is so much cleaner:

1. **No Raw Channel Leaks:**
   Developers manage everything through `group.local.*` or `group.cluster.*`. No need to pass around `channel` instances.

2. **Local Revocation Accepts JS Functions or Criteria:**
   * **Local:** `group.local.revokeWhere((meta) => meta?.userId === '42')` or `group.local.revokeWhere({ userId: '42' })` $\rightarrow$ Revokes only on this process (no Redis message).
   * **Cluster:** `group.cluster.revokeWhere({ userId: '42' })` $\rightarrow$ Revokes locally **and** broadcasts to all other pods.

3. **100% Symmetrical API:**
   Every single operation—**Invalidation**, **Inline Data**, and **Revocation**—exists cleanly on both `group.local` and `group.cluster`!