# Validation & Type Safety Guide

`restale-kit` provides two validation layers: **built-in wire-format structural validation** for incoming SSE frames on the client, and **optional metadata schema validation** via Standard Schema v1 on the server.

---

## 1. Built-In Structural Validation

Client-side structural validation is always active and requires zero configuration. When an SSE message arrives, `SSEInvalidatorClient` validates the payload structure before emitting an `invalidate` event:

1. Verifies that `JSON.parse` succeeds.
2. Asserts that the parsed result is a plain object or an array of plain objects.
3. Validates required fields for the detected target:
   - `tanstack-query`: Asserts `queryKey` is an array.
   - `swr`: Asserts `key` is a string or array.
   - `rtk-query`: Asserts `tags` is an array.
   - `generic`: Asserts `key` is an array.

If structural validation fails, the client drops the payload and fires an `error` event carrying the validation failure.

---

## 2. Metadata Validation via `metaSchema`

When attaching client channels on the server, you can supply a `metaSchema` compliant with **Standard Schema v1** (supported natively by Zod, Valibot, ArkType, etc.) to validate registration metadata.

Validation runs synchronously during `group.attachNodeResponse` or `group.createFetchResponse`. If validation fails, `SchemaValidationError` is thrown immediately.

### Zod Example

```ts
import { z } from 'zod'
import { SSEChannelGroup, SchemaValidationError } from 'restale-kit/server'

const UserMetaSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string(),
  role: z.enum(['admin', 'user']),
})

type UserMeta = z.infer<typeof UserMetaSchema>

const group = new SSEChannelGroup<InvalidateSignal, UserMeta>({
  metaSchema: UserMetaSchema,
})

app.get('/api/sse', (req, res) => {
  try {
    group.attachNodeResponse(req, res, {
      meta: {
        userId: req.user.id,
        tenantId: req.user.tenantId,
        role: req.user.role,
      },
    })
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      console.error('Metadata validation failed:', err.issues)
      res.status(400).send('Invalid metadata')
    }
  }
})
```

### Valibot Example

```ts
import * as v from 'valibot'
import { SSEChannelGroup } from 'restale-kit/server'

const UserMetaSchema = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  role: v.picklist(['admin', 'user']),
})

const group = new SSEChannelGroup({
  metaSchema: UserMetaSchema,
})
```

---

## 3. TypeScript Generics

Constrain signal and metadata types end-to-end across server and client components:

### Server-Side Constrained Group

```ts
import type { TanStackQuerySignal } from 'restale-kit'
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server'

interface AppMeta {
  userId: string
}

const group = new SSEChannelGroup<TanStackQuerySignal, AppMeta>({
  channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
})

// Correct: broadcast is typed strictly to TanStackQuerySignal
group.broadcastToAll({
  queryKey: ['todos'],
})
```

### Client-Side Constrained Hook

```tsx
import type { TanStackQuerySignal } from 'restale-kit'
import { useReStale } from 'restale-kit/react'
import { useTanstackQueryAdapter } from 'restale-kit/tanstack-query'

function Component() {
  const qc = useQueryClient()
  const onInvalidate = useTanstackQueryAdapter<TanStackQuerySignal>(qc)

  useReStale('/api/sse', { onInvalidate })
}
```
