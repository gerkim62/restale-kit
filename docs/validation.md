# Validation & Security Guide

In `restale-kit`, invalidation signals rely on **built-in wire-format structural validation** and **TypeScript compile-time type safety**. You do not need to supply or configure any schemas for invalidation signals.

For connection metadata registered with `SSEChannelGroup`, optional runtime schema validation is available via `metaSchema` using standard schema libraries (Zod, Valibot, ArkType).

---

## Built-in Structural Validation (Always Active)

Every incoming SSE payload is structurally validated by `restale-kit` before being emitted as an `invalidate` event:

1. `JSON.parse` must succeed.
2. Result must be a plain object or array of plain objects.
3. Each object must be a valid `InvalidateSignal` shape for its detected target:

   **`TanStackQuerySignal`** (`target: 'tanstack-query'`):
   - `queryKey` must be present and be an `Array`.
   - `action` (if present) must be one of `'invalidate' | 'refetch' | 'reset' | 'remove' | 'cancel'`.
   - `exact` (if present) must be `boolean`.
   - `type` (if present) must be `'all' | 'active' | 'inactive'`.

   **`SWRSignal`** (`target: 'swr'`):
   - `key` must be present and be a `string` or `Array`.
   - `action` (if present) must be one of `'revalidate' | 'purge' | 'remove'`.
   - `match` (if present) must be `'exact' | 'prefix'`.
   - `revalidate` (if present) must be `boolean`.

   **`RTKQuerySignal`** (`target: 'rtk-query'`):
   - `tags` must be present and be an `Array`.

   **`GenericInvalidateSignal`** (`target: 'generic'` or `target` absent):
   - `key` must be present and be an `Array`.
   - `exact` (if present) must be `boolean`.
   - `action` (if present) must be one of `'invalidate' | 'refetch' | 'remove'`.

4. Unknown fields are ignored (forward-compatible).

If any of these structural checks fail, the client emits an `error` event instead of `invalidate`.

---

## Metadata Validation with `metaSchema` (Optional)

When attaching channels to an `SSEChannelGroup`, you can pass a Standard Schema (Zod, Valibot, etc.) as `metaSchema` to validate client metadata at registration time:

```ts
import { z } from 'zod'
import { SSEChannelGroup } from 'restale-kit/server'

const ClientMetaSchema = z.object({
  userId: z.string(),
  role: z.enum(['user', 'admin']),
})
type ClientMeta = z.infer<typeof ClientMetaSchema>

const group = new SSEChannelGroup<InvalidateSignal, ClientMeta>({
  target: 'tanstack-query',
  metaSchema: ClientMetaSchema,
})

app.get('/sse', (req, res) => {
  // Throws SchemaValidationError if metadata validation fails
  group.attachChannel(req, res, {
    meta: {
      userId: req.user.id,
      role: req.user.role,
    },
  })
})

// Predicate in broadcast is fully typed against ClientMeta:
group.broadcast(
  { key: ['admin-data'] },
  (meta) => meta.role === 'admin' // ✅ fully typed
)
```

### `SchemaValidationError`

When metadata fails validation against `metaSchema`, `SchemaValidationError` is thrown synchronously during registration:

```ts
import { SchemaValidationError } from 'restale-kit'

try {
  group.attachChannel(req, res, { meta: invalidMeta })
} catch (err) {
  if (err instanceof SchemaValidationError) {
    console.error(err.message) // formatted issue summary
    console.error(err.issues)  // StandardSchemaV1.Issue array
  }
}
```
