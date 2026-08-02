# `retriesexhausted` Event Example

The `retriesexhausted` event is dispatched by `SSEInvalidatorClient` when automatic reconnection attempts reach `maxRetries` without establishing a successful connection.

## Event Details

- **Event Name**: `'retriesexhausted'`
- **Payload (`detail`)**: `{ attempts: number; maxRetries: number }`

## Vanilla JS / Node Client Usage

```ts
import { SSEInvalidatorClient } from 'restale-kit/client'

const client = new SSEInvalidatorClient('/api/sse', {
  autoReconnect: true,
  reconnect: {
    maxRetries: 3,
  },
})

client.addEventListener('retriesexhausted', (event) => {
  console.warn(
    `Reconnection failed after ${event.detail.attempts} attempts (max ${event.detail.maxRetries}).`
  )
  // Display offline banner or trigger fallback polling
})
```

## React Hook (`useReStale`) Usage

```tsx
import { useReStale } from 'restale-kit/react'

function App() {
  const { isConnected, isError, attempt } = useReStale('/api/sse', {
    reconnect: { maxRetries: 5 },
    onRetriesExhausted: ({ attempts, maxRetries }) => {
      showToast(`Connection lost after ${attempts}/${maxRetries} attempts.`)
    },
    onInvalidate,
  })

  return (
    <div>
      {isError && <p>Connection failed permanently. Please refresh.</p>}
    </div>
  )
}
```
