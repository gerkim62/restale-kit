import { SSEChannelGroup } from 'restale-kit/server'

// Minimal Fetch API implementation (compatible with Bun.serve, Deno.serve, Cloudflare Workers, Next.js)
const group = new SSEChannelGroup({
  secret: 'fetch-server-secret-key-32-chars-min',
})

export async function fetchHandler(request: Request): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/sse') {
    return group.handle(request)
  }

  if (url.pathname === '/api/mutate' && request.method === 'POST') {
    // Invalidate todos across all connected clients
    group.local.broadcast({ key: ['todos'] }, () => true)
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response('Not Found', { status: 404 })
}

// If running in Node.js environment with native fetch / http
export default {
  fetch: fetchHandler,
}
