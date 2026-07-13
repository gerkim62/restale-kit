# restale-kit

`restale-kit` delivers server-sent invalidation signals to client caches. It is an ESM-only package for Node.js 20+.

## Install

```sh
npm install restale-kit
```

Install an integration peer when using its corresponding entry point:

```sh
npm install react @tanstack/react-query swr ioredis ably pusher
```

All integration peers are optional; install only the packages your application uses.

## Public imports

```ts
import type { InvalidateSignal } from 'restale-kit'
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/node'
import { toSSEResponse } from 'restale-kit/fetch'
import { SSEInvalidatorClient } from 'restale-kit/client'
import { useReStale } from 'restale-kit/react'
import { swrAdapter } from 'restale-kit/swr'
import { tanstackAdapter } from 'restale-kit/tanstack-query'
import type { PubSubAdapter } from 'restale-kit/pubsub'
import { redisPubSubAdapter } from 'restale-kit/redis'
import { ablyPubSubAdapter } from 'restale-kit/ably'
import { pusherPubSubAdapter } from 'restale-kit/pusher'
import { attachSSE as attachExpressSSE } from 'restale-kit/express'
import { attachSSE as attachFastifySSE } from 'restale-kit/fastify'
import { toSSEResponse as toHonoSSEResponse } from 'restale-kit/hono'
```

For end-to-end server and client wiring, see the repository's [usage guide](https://github.com/gerkim62/restale-kit/blob/main/docs/usage.md), [API contract](https://github.com/gerkim62/restale-kit/blob/main/docs/sse-query-invalidate-contract.md), and [runnable examples](https://github.com/gerkim62/restale-kit/tree/main/examples).

## Basic example

```ts
import { SSEChannelGroup } from 'restale-kit/server'
import { attachSSE } from 'restale-kit/express'

const group = new SSEChannelGroup()

app.get('/sse', (req, res) => {
  const channel = attachSSE(req, res)
  group.register(channel, {})
  req.on('close', () => group.deregister(channel))
})

group.broadcastToAll({ key: ['todos'] })
```

## Releases

Releases use manual Semantic Versioning. Update `version` and this changelog, commit the changes, then create and push the matching tag (`vX.Y.Z`). The GitHub release workflow validates the tag and publishes with npm provenance. npm ownership and trusted publishing for this repository must be configured before the first release.
