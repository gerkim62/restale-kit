import test from 'node:test'
import assert from 'node:assert/strict'
import { SSEInvalidatorClient } from '../client/core/sse-client.js'

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = []

  onopen: ((this: EventSource, event: Event) => unknown) | null = null
  onerror: ((this: EventSource, event: Event) => unknown) | null = null

  constructor(
    readonly url: string,
    readonly options?: EventSourceInit
  ) {
    super()
    MockEventSource.instances.push(this)
  }

  close(): void {}
}

void test('SSEInvalidatorClient passes withCredentials to EventSource', () => {
  const originalEventSource = globalThis.EventSource
  MockEventSource.instances = []
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource

  try {
    const client = new SSEInvalidatorClient('/sse', { withCredentials: true })
    void client.connect()

    assert.strictEqual(MockEventSource.instances.length, 1)
    assert.strictEqual(MockEventSource.instances[0]?.url, '/sse')
    assert.deepStrictEqual(MockEventSource.instances[0]?.options, { withCredentials: true })
  } finally {
    globalThis.EventSource = originalEventSource
  }
})

void test('SSEInvalidatorClient defaults withCredentials to false', () => {
  const originalEventSource = globalThis.EventSource
  MockEventSource.instances = []
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource

  try {
    const client = new SSEInvalidatorClient('/sse')
    void client.connect()

    assert.deepStrictEqual(MockEventSource.instances[0]?.options, { withCredentials: false })
  } finally {
    globalThis.EventSource = originalEventSource
  }
})
