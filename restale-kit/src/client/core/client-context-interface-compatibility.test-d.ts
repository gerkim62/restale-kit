import { describe, test } from 'vitest'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'
import { makeAdaptedCallback } from '@/client/core/client-contracts.js'
import { useReStale } from '@/client/react/useReStale.js'
import type { SWRSignal } from '@/types/protocol.js'

interface ClientContext {
  page: number
  pageSize: number
}

describe('client context interface compatibility', () => {
  test('accepts ordinary interfaces while retaining runtime JSON validation', () => {
    const context: ClientContext = { page: 1, pageSize: 20 }
    const client = new SSEInvalidatorClient('https://example.com/sse')
    void client.updateClientContext(context)

    const onInvalidate = makeAdaptedCallback('swr', (_signal: SWRSignal | SWRSignal[]) => {})
    useReStale('/sse', { onInvalidate, clientContext: context })
  })
})
