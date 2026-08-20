# Validation & Security Guide

In `restale-kit`, invalidation signals rely on **built-in wire-format structural validation** and **TypeScript compile-time type safety**. You do not need to supply or configure any schemas for invalidation signals.

For connection metadata registered with `SSEChannelGroup`, optional runtime schema validation is available via `metaSchema` using standard schema libraries (Zod, Valibot, ArkType). The same Standard Schema mechanism validates untrusted client query context through `clientContextSchema`.

---

## Built-in Structural Validation (Always Active)

Every incoming SSE payload is structurally validated by `restale-kit` before being emitted as an `invalidate` event:

1. `JSON.parse` must succeed.
2. Result must be a plain object or array of plain objects.
3. Each object must be a valid `Signal` shape:
   - `key` must be present and be a JSON-safe `Array` of JSON values.
   - **`RevalidateSignal`**:
     - `exact` (if present) must be a `boolean`.
     - Cannot carry `inlineData` or `markStale`.
   - **`InlineDataSignal`**:
     - `inlineData` must be present and be a valid JSON value.
     - `markStale` (if present) must be a `boolean`.
     - Cannot specify `exact` (inline data writes are strictly exact).
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

const group = new SSEChannelGroup<ClientMeta>({
  metaSchema: ClientMetaSchema,
})

app.get('/sse', (req, res) => {
  // Throws SchemaValidationError if metadata validation fails
  group.attachNodeResponse(req, res, {
    meta: {
      userId: req.user.id,
      role: req.user.role,
    },
  })
})

// Predicate in broadcast is fully typed against ClientMeta:
group.broadcast(
  { key: ['admin-data'] },
  (meta) => meta?.role === 'admin' // ✅ fully typed
)
```

### `SchemaValidationError`

When metadata fails validation against `metaSchema`, `SchemaValidationError` is thrown synchronously during registration:

```ts
import { SchemaValidationError } from 'restale-kit'

try {
  group.attachNodeResponse(req, res, { meta: invalidMeta })
} catch (err) {
  if (err instanceof SchemaValidationError) {
    console.error(err.message) // formatted issue summary
    console.error(err.issues)  // StandardSchemaV1.Issue array
  }
}
```

---

## Client context validation with `clientContextSchema`

`clientContext` is supplied by the browser after the SSE stream opens. It is useful for page, sort, and filter state, but it is not an authorization input. Validate its shape with `clientContextSchema`, and use `meta` or the authenticated request to determine what data the resolver may return.

```ts
const clientContextSchema = z.object({
  page: z.number().int().min(0),
  pageSize: z.number().int().min(1).max(100),
})

const group = new SSEChannelGroup({
  clientContextSchema,
  resolveInlineData: async (connections, payload) => {
    // connections[i].meta decides authorization.
    // connections[i].clientContext decides the authorized result's page/shape.
    return new Map()
  },
})
```

`group.updateClientContext(connectionId, value, { scope })` returns a promise that rejects with `SchemaValidationError` when the value is invalid, without changing stored context. Await it in the HTTP route and catch that rejection to return `400`; scope-pin the connection ID with trusted metadata before applying an update.

See [Client Context & Inline Data](./inline-data.md) for the complete route and resolver example.
