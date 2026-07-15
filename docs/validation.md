# Validation Guide

`restale-kit` integrates with the [Standard Schema spec v1](https://github.com/standard-schema/standard-schema), supported natively by **Zod**, **Valibot**, **ArkType**, and other schema libraries.

Validation is **optional**. Without a schema, the library uses plain `InvalidateSignal` types with built-in structural validation only.

---

## Built-in structural validation (always active)

Every incoming SSE payload is structurally validated before being emitted as an `invalidate` event, regardless of whether you provide a schema:

1. `JSON.parse` must succeed.
2. Result must be a plain object or array of plain objects.
3. Each object must have a `key` property that is an `Array`.
4. `exact` (if present) must be `boolean`.
5. `action` (if present) must be `'invalidate' | 'refetch' | 'remove'`.
6. Unknown fields are ignored (forward-compatible).

If any of the above fail, the client emits an `error` event instead of `invalidate`.

---

## Schema validation (optional)

Pass a Standard Schema to enforce further type constraints at runtime:

- **Server-side `signalSchema`** — validates signals before `channel.invalidate()` sends them.
- **Server-side `metaSchema`** — validates connection metadata in `group.register()`.
- **Client-side `signalSchema`** — validates received signals after structural validation (step 7 of the client validation pipeline).

---

## Server-side validation with Zod

### Signal validation

```ts
import { z } from 'zod'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/express'

const AppSignalSchema = z.object({
  key: z.union([
    z.tuple([z.literal('todos')]),
    z.tuple([z.literal('todos'), z.object({ userId: z.string() })]),
    z.tuple([z.literal('users'), z.string()]),
  ]),
  exact: z.boolean().optional(),
  action: z.enum(['invalidate', 'refetch', 'remove']).optional(),
})
type AppSignal = z.infer<typeof AppSignalSchema>

const group = new SSEChannelGroup<AppSignal>()

app.get('/sse', (req, res) => {
  // channel is typed as SSEChannel<AppSignal>
  const { channel, connectionId } = attachSSE(req, res, { signalSchema: AppSignalSchema })
  group.register(channel, { connectionId })
  req.on('close', () => group.deregister(channel))
})

// TypeScript enforces valid signal shapes at compile time:
group.broadcastToAll({ key: ['todos'] })                          // ✅
group.broadcastToAll({ key: ['todos', { userId: '42' }] })        // ✅
// group.broadcastToAll({ key: ['posts'] })                       // ❌ TypeScript error
```

### Metadata validation

```ts
const ClientMetaSchema = z.object({
  userId: z.string(),
  role: z.enum(['user', 'admin']),
  connectionId: z.string(),
})
type ClientMeta = z.infer<typeof ClientMetaSchema>

const group = new SSEChannelGroup<AppSignal, ClientMeta>({
  metaSchema: ClientMetaSchema,
})

app.get('/sse', (req, res) => {
  const { channel, connectionId } = attachSSE(req, res, { signalSchema: AppSignalSchema })

  // Throws SchemaValidationError if validation fails
  group.register(channel, {
    userId: req.user.id,
    role: req.user.role,
    connectionId,
  })
  req.on('close', () => group.deregister(channel))
})

// Predicate is now fully typed against ClientMeta:
group.broadcast(
  { key: ['admin-data'] },
  (meta) => meta.role === 'admin' // ✅ typed
)
```

### Combining both schemas

```ts
const group = new SSEChannelGroup<AppSignal, ClientMeta>({
  metaSchema: ClientMetaSchema,
})

app.get('/sse', (req, res) => {
  const { channel, connectionId } = attachSSE(req, res, { signalSchema: AppSignalSchema })
  group.register(channel, { userId: req.user.id, role: req.user.role, connectionId })
  req.on('close', () => group.deregister(channel))
})
```

---

## Client-side validation with Zod

```tsx
import { z } from 'zod'
import { useReStale } from 'restale-kit/react'
import { tanstackAdapter } from 'restale-kit/tanstack-query'
import { useQueryClient } from '@tanstack/react-query'

const AppSignalSchema = z.object({
  key: z.array(z.unknown()),
  exact: z.boolean().optional(),
  action: z.enum(['invalidate', 'refetch', 'remove']).optional(),
})
type AppSignal = z.infer<typeof AppSignalSchema>

function App() {
  const queryClient = useQueryClient()

  // Incoming signals are validated; if they fail, 'error' is emitted instead of 'invalidate'
  useReStale<AppSignal>('/sse', {
    signalSchema: AppSignalSchema,
    onInvalidate: tanstackAdapter(queryClient), // typed as (signal: AppSignal | AppSignal[]) => void
  })
}
```

---

## Using with `SSEInvalidatorClient` directly

```ts
import { SSEInvalidatorClient } from 'restale-kit/client'

const client = new SSEInvalidatorClient('/sse', {
  signalSchema: AppSignalSchema,
})

client.addEventListener('error', (event) => {
  // Fires when schema validation fails on an incoming signal
  console.error('Validation error:', event.detail)
})
```

---

## Async schemas

`restale-kit` is **synchronous throughout**. If a schema's `validate` function returns a `Promise`, it throws `SchemaValidationError` with the message `"async schemas are not supported"`. Use synchronous schemas only.

---

## Error types

### `SchemaValidationError`

```ts
import { SchemaValidationError } from 'restale-kit'

try {
  channel.invalidate({ key: ['posts'] }) // fails if schema doesn't allow 'posts'
} catch (err) {
  if (err instanceof SchemaValidationError) {
    console.error(err.message) // formatted string
    console.error(err.issues)  // ReadonlyArray<StandardSchemaV1.Issue>
  }
}
```

### `ChannelClosedError`

```ts
import { ChannelClosedError } from 'restale-kit'

try {
  channel.invalidate({ key: ['todos'] })
} catch (err) {
  if (err instanceof ChannelClosedError) {
    // Channel was already closed — deregister from group
  }
}
```

> **Note:** You normally don't need to catch these — `SSEChannelGroup` handles `ChannelClosedError` automatically during broadcast.

---

## Standard Schema compatibility

Any library implementing the Standard Schema v1 spec works. You don't need Zod specifically:

```ts
import * as v from 'valibot'

const AppSignalSchema = v.object({
  key: v.array(v.unknown()),
  exact: v.optional(v.boolean()),
  action: v.optional(v.picklist(['invalidate', 'refetch', 'remove'])),
})

const channel = attachSSE(req, res, { signalSchema: AppSignalSchema })
```
