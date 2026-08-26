# Ably Pub/Sub Recipe

Distributed cache invalidation across pods using `ablyPubSubAdapter`.

---

## Implementation

<!-- snippet:start pubsub-ably -->
```ts
import Ably from 'ably'
import { SSEChannelGroup } from 'restale-kit/server'
import { ablyPubSubAdapter } from 'restale-kit/ably'

const ably = new Ably.Realtime(process.env.ABLY_API_KEY || 'fake:key')

const group = new SSEChannelGroup({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  pubsub: ablyPubSubAdapter(ably),
})

export async function broadcastViaAbly(topic: string, queryKey: string[]) {
  await group.cluster.broadcast(topic, {
    key: queryKey,
  })
}
```
<!-- snippet:end -->
