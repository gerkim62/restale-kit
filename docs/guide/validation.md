# Schema Validation

ReStale Kit integrates with the **Standard Schema** specification (supported by Zod, Valibot, ArkType, and TypeBox) to validate metadata and client context.

---

## 1. Validating Server Metadata (`metaSchema`)

`metaSchema` validates the server-side metadata provided to `group.handle(req, res, { meta })` or `group.register()`. If validation fails, `SSEChannelGroup` throws `SchemaValidationError`.

---

## 2. Validating Client Context (`clientContextSchema`)

Clients send their active query keys to POST `/api/sse`. Because this endpoint receives untrusted JSON from the browser, `clientContextSchema` validates the payload. Validation failures automatically return **HTTP 422 Unprocessable Entity**.

<!-- snippet:start validation-schema -->
```ts
import { z } from 'zod'
import { SSEChannelGroup } from 'restale-kit/server'

// Server metadata schema (validated on SSE connect)
const UserMetaSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'member', 'guest']),
})

type UserMeta = z.infer<typeof UserMetaSchema>

// Client context schema (validated on POST /api/sse from client)
const ClientContextSchema = z.object({
  activeQueries: z.array(z.string()),
  viewingProjectId: z.string().optional(),
})

type ClientContext = z.infer<typeof ClientContextSchema>

export const group = new SSEChannelGroup<UserMeta, ClientContext>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
  metaSchema: UserMetaSchema,
  clientContextSchema: ClientContextSchema,
})
```
<!-- snippet:end -->

---

## Doctest

```ts doctest:validation_verification
import { SSEChannelGroup } from 'restale-kit/server'

const schema = {
  '~standard': {
    version: 1 as const,
    vendor: 'test',
    validate: (val: unknown) => ({ value: val as { userId: string } }),
  },
}

const group = new SSEChannelGroup({
  secret: 'validation-test-secret-32-chars',
  metaSchema: schema,
  scopeBy: ['userId'],
})

expect(group.secret).toBe('validation-test-secret-32-chars')
```
