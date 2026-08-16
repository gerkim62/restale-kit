# Next.js & Serverless Best Practices

When running `restale-kit` in Next.js (App Router or Pages Router) or serverless environments (e.g. Vercel, AWS Lambda), understanding how module lifecycle and Hot Module Replacement (HMR) work is critical to avoid duplicate channels, memory leaks, and runaway Redis connection counts.

---

## 📋 Serverless & Next.js Checklist

> [!IMPORTANT]
> Keep this checklist in mind whenever deploying to Next.js or Serverless:
>
> - [ ] **Instance created once in a shared module** (e.g., `lib/restale.ts`)
> - [ ] **Cached via `globalThis` in development** to avoid duplicate instances during HMR
> - [ ] **Never instantiate `new SSEChannelGroup()` or `new Redis()` inside a route handler or component body**
> - [ ] **Use a distributed Pub/Sub adapter** (e.g. Redis, Ably, Pusher) if mutations and SSE streams can run across separate serverless execution isolates

---

## ❌ The Anti-Pattern: Instantiating in Route Handlers or Module Scope Without `globalThis`

### ❌ Wrong: Instantiating Inside Route Handlers or Component Bodies

```ts
// ❌ DON'T DO THIS: Spawns a brand-new group on every single request
export async function GET(req: Request) {
  const group = new SSEChannelGroup();
  return group.createFetchResponse(req);
}
```

### ❌ Wrong: Uncached Module-Level Instantiation in Next.js

```ts
// ❌ DON'T DO THIS in Next.js dev server:
// Re-evaluated on every hot reload, spawning duplicate channel groups,
// detached listeners, and unmanaged Redis connection leaks.
export const channelGroup = new SSEChannelGroup({
  pubsub: redisPubSubAdapter(new Redis(process.env.REDIS_URL!)),
});
```

---

## ✅ The Recommended Pattern: Singleton via `globalThis`

Next.js re-evaluates modules frequently during development (Hot Module Replacement / fast refresh). To preserve active channel groups and prevent leaking connections, attach instances to `globalThis` during development.

This is the exact same singleton pattern recommended by [Prisma's Next.js Best Practices](https://www.prisma.io/docs/guides/other/troubleshooting-orm/help-articles/nextjs-prisma-client-dev-practices).

### File Convention: `lib/restale.ts`

Put this in a shared module (such as `lib/restale.ts` or `src/lib/restale.ts`) and **import that module everywhere**; never call `new SSEChannelGroup()` elsewhere in your codebase.

```ts
// lib/restale.ts
import Redis from 'ioredis';
import { SSEChannelGroup, SIGNAL_TARGETS } from 'restale-kit/server';
import { redisPubSubAdapter } from 'restale-kit/redis';

// 1. Maintain singleton references across HMR cycles
const globalForRestale = globalThis as unknown as {
  redis?: Redis;
  channelGroup?: SSEChannelGroup;
};

// 2. Initialize Redis client (if using distributed pub/sub)
const redis =
  globalForRestale.redis ??
  new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

// 3. Initialize SSEChannelGroup
export const channelGroup =
  globalForRestale.channelGroup ??
  new SSEChannelGroup({
    channelDefaults: { target: SIGNAL_TARGETS.TANSTACK_QUERY },
    pubsub: redisPubSubAdapter(redis),
  });

// 4. Save to globalThis in development mode
if (process.env.NODE_ENV !== 'production') {
  globalForRestale.redis = redis;
  globalForRestale.channelGroup = channelGroup;
}
```

---

## 🛠️ Usage in Next.js App Router

### 1. SSE Stream Route Handler (`app/api/sse/route.ts`)

```ts
// app/api/sse/route.ts
import { channelGroup } from '@/lib/restale';

export const dynamic = 'force-dynamic'; // Prevent static caching
export const runtime = 'nodejs'; // Ensure standard Node.js streaming runtime

export async function GET(req: Request) {
  // Optional: read auth / user info from session headers
  const userId = req.headers.get('x-user-id') ?? undefined;

  return channelGroup.createFetchResponse(req, {
    meta: userId ? { userId } : undefined,
    topics: userId ? [`user:${userId}`] : undefined,
  });
}
```

### 2. Mutation Route Handler or Server Action (`app/api/todos/route.ts`)

```ts
// app/api/todos/route.ts
import { NextResponse } from 'next/server';
import { channelGroup } from '@/lib/restale';

export async function POST(req: Request) {
  const body = await req.json();

  // ... perform database mutation ...

  // Broadcast invalidation signal to all connected clients
  await channelGroup.broadcastToAll({
    queryKey: ['todos'],
  });

  return NextResponse.json({ success: true });
}
```

---

## 🔍 Why This Matters: HMR & Cold Starts Explained

1. **Hot Module Replacement (Development):**
   In dev mode, Next.js clears the `require`/ESM cache whenever you edit a file, but the Node.js process stays running. Without caching on `globalThis`, every code change executes `new SSEChannelGroup()` and `new Redis()`, abandoning old connections and listeners while creating new ones. This causes duplicate events and connection exhaustion.
2. **Serverless Scaling & Cold Starts (Production):**
   In serverless environments (e.g. AWS Lambda / Vercel), each container isolate handles requests independently. When a client connects to the SSE route on Instance A and a mutation executes on Instance B, instance-local memory is isolated. Using a shared Pub/Sub adapter (like Redis) ensures signals published on Instance B reach Instance A instantly.

---

## ❓ Troubleshooting

### Seeing duplicate invalidation events or growing Redis connection count?

- **Symptom:** Every time you save a file in development, events trigger twice/thrice, or Redis connection counts climb steadily.
- **Cause:** `SSEChannelGroup` or `Redis` is being instantiated anew on module reload.
- **Solution:** Verify you are using the `globalThis` singleton pattern in `lib/restale.ts` and importing `channelGroup` rather than instantiating it inside route handlers or page files.

### SSE Stream closes immediately in Next.js App Router?

- **Symptom:** The client connects and immediately gets disconnected or receives a static response.
- **Cause:** Route was statically cached or ran on an unsupported runtime.
- **Solution:** Add `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'` at the top of your `app/api/sse/route.ts`.
