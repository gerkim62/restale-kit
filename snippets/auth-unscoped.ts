import { SSEChannelGroup } from 'restale-kit/server'

// Unauthenticated / public event streams (no TMeta, no scopeBy)
const group = new SSEChannelGroup({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
})

export async function handlePublicSSE(request: Request): Promise<Response> {
  return group.handle(request)
}

export function broadcastPublicUpdate(articleId: string) {
  // Broadcast to every connected client
  group.local.broadcast(
    { key: ['articles', articleId] },
    () => true,
  )
}
