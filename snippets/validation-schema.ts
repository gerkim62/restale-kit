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
