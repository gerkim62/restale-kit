# Troubleshooting Guide

This guide details common errors, symptoms, root causes, and resolutions when integrating `restale-kit`.

---

## 1. Missing `__restale_cid__` / Direct Browser Open Error

### Symptom
Opening the SSE endpoint (e.g. `http://localhost:3000/api/sse`) directly in a browser tab or via `curl` fails with an HTTP error or logs:
`Error: Missing required __restale_cid__ query parameter`.

### Likely Cause
`group.attachNodeResponse` and `group.createFetchResponse` require the client-generated correlation ID parameter `__restale_cid__`. The `restale-kit` client SDK (`useReStale`, `SSEInvalidatorClient`) appends this query parameter automatically upon connection.

### Fix
Do not open the raw SSE URL directly in a browser tab. Connect using `useReStale` or `SSEInvalidatorClient`. For manual curl testing, append a dummy UUID:
```sh
curl "http://localhost:3000/api/sse?__restale_cid__=123e4567-e89b-12d3-a456-426614174000"
```

---

## 2. Queries Not Refetching After `broadcastToAll`

### Symptom
`group.broadcastToAll` is called on the server, but active client UI queries do not refetch data.

### Likely Cause
1. **Target Mismatch**: The channel's target discriminator (e.g. `'tanstack-query'`) does not match the client adapter target.
2. **Key Field Mismatch**: The invalidation signal specifies `key` instead of `queryKey` for TanStack Query signals.
3. **No Active Observers**: In TanStack Query, inactive queries (no mounted components observing the query key) are marked stale but do not refetch until re-observed.

### Fix
Verify signal field names match your target framework:
- For TanStack Query: `{ queryKey: ['todos'] }`
- For SWR: `{ key: '/api/todos' }`

---

## 3. Connection Never Opens (`isConnected` Stays `false`)

### Symptom
`useReStale` returns `isConnected: false` and status remains `connecting` indefinitely.

### Likely Cause
1. `disabled: true` option was passed to `useReStale`.
2. CORS preflight or response headers are missing or misconfigured on cross-origin requests.
3. Server route handler failed to return the stream response in Fetch-based runtimes (e.g., omitting `return response` in Hono/Cloudflare Workers).

### Fix
Check browser DevTools console for CORS errors. Ensure your server handler returns the response object created by `createFetchResponse`:
```ts
app.get('/api/sse', (c) => {
  const { response } = group.createFetchResponse(c.req.raw)
  return response // Ensure response is returned
})
```

---

## 4. `ChannelClosedError` Thrown

### Symptom
Server logs throw `ChannelClosedError: Cannot send on a closed channel`.

### Likely Cause
The application code called `channel.invalidate()` directly on an `SSEChannel` instance after the client stream disconnected or closed.

### Fix
Broadcast signals using `group.broadcastToAll` or `group.broadcast` instead of retaining and calling methods on individual `SSEChannel` references. `SSEChannelGroup` automatically cleans up disconnected channels.

---

## 5. `SchemaValidationError` on Registration

### Symptom
Server throws `SchemaValidationError: Schema validation failed: ...` when a client connects.

### Likely Cause
The `meta` object passed to `attachNodeResponse` or `createFetchResponse` failed validation against the group's `metaSchema`.

### Fix
Inspect `err.issues` to identify the failing property. Ensure auth middleware populates all required metadata fields matching your schema before registration.

---

## 6. Queries Refetching on Every Connection (No Key Matching)

### Symptom
Every query in the application refetches as soon as the SSE connection opens.

### Likely Cause
An empty signal key array (e.g. `{ queryKey: [] }`) or wildcards were broadcast, which matches all queries in the cache.

### Fix
Specify explicit key prefixes when broadcasting invalidations (e.g. `{ queryKey: ['todos', todoId] }`).

---

## 7. Pub/Sub Messages Not Delivered Across Instances

### Symptom
Mutations on Server Node A do not invalidate queries for clients connected to Server Node B.

### Likely Cause
1. Server nodes are connected to different Redis/Ably/Pusher clusters or databases.
2. The client channels were not assigned to the topic being published to (`topics: ['topic_name']`).

### Fix
Confirm that all server nodes share the same pub/sub configuration and topic names. Verify that client connections register matching topic arrays.

---

## 8. Decryption Failures in Pub/Sub

### Symptom
Server logs display warnings: `[pubsub] Failed to decrypt message envelope...` and dropped messages.

### Likely Cause
1. Mismatched `encryptionKey` strings between server nodes (e.g. Node A has Key 1, Node B has Key 2).
2. Mixed-mode setup: one server node has encryption enabled while another node publishes unencrypted payloads.

### Fix
Ensure all nodes in the cluster use the exact same encryption key environment variable and configuration options. See [Pub/Sub Guide → Encryption](./pubsub.md#encryption).

---

## 9. Fastify `reply.hijack()` Errors

### Symptom
Fastify throws `FST_ERR_REP_ALREADY_SENT` or raw socket error when establishing SSE streams.

### Likely Cause
Consumer code called `reply.hijack()` manually before passing `reply` to `group.attachNodeResponse`.

### Fix
Remove manual `reply.hijack()` calls. `attachNodeResponse` automatically detects Fastify reply objects and handles socket hijacking cleanly.

---

## 10. `target` Mismatch Warnings

### Symptom
Console warning: `[restale-kit] Client requested target "swr" but channel supports "tanstack-query"`.

### Likely Cause
The client hook (`useSwrAdapter`) requested a target discriminator that differs from the server group's configured `target`.

### Fix
Align server group target configuration with the client framework adapters in use:
```ts
// Server configured for SWR
const group = new SSEChannelGroup({
  channelDefaults: { target: SIGNAL_TARGETS.SWR },
})
```
