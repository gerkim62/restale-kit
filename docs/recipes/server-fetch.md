# Web Fetch API Server Recipe

Using `SSEChannelGroup` with native Fetch API `Request`/`Response` (Bun, Deno, Cloudflare Workers, Next.js).

---

## Implementation

<!-- snippet:start server-fetch -->
```ts
import { SSEChannelGroup } from 'restale-kit/server'

interface UserMeta {
  userId: string
}

const group = new SSEChannelGroup<UserMeta>({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  scopeBy: ['userId'],
})

// Universal Web Fetch handler (Next.js, Bun.serve, Deno.serve, Cloudflare)
export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/api/sse') {
    const userId = url.searchParams.get('userId') || 'anonymous'
    return group.handle(request, {
      meta: { userId },
    })
  }

  if (url.pathname === '/api/todos' && request.method === 'POST') {
    const userId = url.searchParams.get('userId') || 'anonymous'

    group.local.broadcast(
      { key: ['todos', { userId }] },
      (meta) => meta?.userId === userId,
    )

    return new Response(JSON.stringify({ success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response('Not Found', { status: 404 })
}
```
<!-- snippet:end -->
