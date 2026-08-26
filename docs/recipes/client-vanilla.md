# Vanilla JavaScript Client Recipe

Using `SSEClient` without React or external UI frameworks.

---

## Implementation

<!-- snippet:start client-vanilla -->
```ts
import { SSEClient, type ConnectionStatus, type Signal } from 'restale-kit/client'

const client = new SSEClient('/api/sse?userId=user_123', {
  reconnect: {
    maxRetries: 10,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  },
  callback(signal: Signal | Signal[]) {
    console.log('Received invalidation signal:', signal)
    // Custom cache invalidation logic for any framework or custom store
  },
})

// Listen to lifecycle events
client.addEventListener('statuschange', (event: Event) => {
  const customEvent = event as CustomEvent<ConnectionStatus>
  console.log('Connection status changed to:', customEvent.detail.status)
})

client.addEventListener('revoke', (event: Event) => {
  const customEvent = event as CustomEvent<{ reason?: string }>
  console.warn('Connection permanently revoked:', customEvent.detail?.reason)
})

// Open connection
client.connect()
```
<!-- snippet:end -->
