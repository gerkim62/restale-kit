# Pusher Pub/Sub Recipe

Distributed cache invalidation across pods using `pusherPubSubAdapter`.

---

## Implementation

<!-- snippet:start pubsub-pusher -->
```ts
import Pusher from 'pusher'
import { SSEChannelGroup } from 'restale-kit/server'
import { pusherPubSubAdapter } from 'restale-kit/pusher'

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '12345',
  key: process.env.PUSHER_KEY || 'pusher_key',
  secret: process.env.PUSHER_SECRET || 'pusher_secret',
  cluster: process.env.PUSHER_CLUSTER || 'mt1',
  useTLS: true,
})

const group = new SSEChannelGroup({
  secret: process.env.RESTALE_SECRET || 'secret-key-at-least-32-chars-long',
  pubsub: pusherPubSubAdapter(pusher),
})

export async function broadcastViaPusher(topic: string, queryKey: string[]) {
  await group.cluster.broadcast(topic, {
    key: queryKey,
  })
}
```
<!-- snippet:end -->
