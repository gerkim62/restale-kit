import test from 'node:test'
import assert from 'node:assert'
import { SSEChannelGroup } from '@/server/core/channel-group.js'
import type { PubSubAdapter } from '@/pubsub/core/index.js'
import { createSSEChannel } from '@/server/core/channel.js'

// Simple defer helper
interface Deferred<T> {
  promise: Promise<T>
  resolve: (val: T) => void
  reject: (err: unknown) => void
}

function defer<T>(): Deferred<T> {
  let resolveValue!: (val: T) => void
  let rejectError!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolveValue = res
    rejectError = rej
  })
  return { promise, resolve: resolveValue, reject: rejectError }
}

void test('PubSub Adapter Core Integration', async (t) => {
  await t.test('refcounting and subscription lifecycle', async () => {
    let subscribeCalls = 0
    let unsubscribeCalls = 0

    const mockPubSub: PubSubAdapter = {
      publish: () => Promise.resolve(),
      subscribe: (topic) => {
        if (topic !== '__restale_control__') {
          subscribeCalls++
        }
        return Promise.resolve(() => {
          if (topic !== '__restale_control__') {
            unsubscribeCalls++
          }
        })
      }
    }

    const group = new SSEChannelGroup({ pubsub: mockPubSub })
    const ch1 = createSSEChannel()
    const ch2 = createSSEChannel()

    // First register: should trigger subscribe
    group.register(ch1, {}, { topics: ['topic-a'] })
    // Allow microtasks to process TopicManager async queue
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
    assert.strictEqual(subscribeCalls, 1)

    // Second register on same topic: should NOT trigger subscribe
    group.register(ch2, {}, { topics: ['topic-a'] })
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
    assert.strictEqual(subscribeCalls, 1)

    // Deregister first channel: should NOT trigger unsubscribe
    group.deregister(ch1)
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
    assert.strictEqual(unsubscribeCalls, 0)

    // Deregister second channel: should trigger unsubscribe
    group.deregister(ch2)
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
    assert.strictEqual(unsubscribeCalls, 1)
  })

  await t.test('concurrent register / deregister serialization', async () => {
    let subscribeCalls = 0
    let unsubscribeCalls = 0
    const delayDeferred = defer<undefined>()

    const mockPubSub: PubSubAdapter = {
      publish: () => Promise.resolve(),
      subscribe: async (topic) => {
        if (topic === '__restale_control__') {
          return () => {}
        }
        subscribeCalls++
        await delayDeferred.promise
        return () => {
          unsubscribeCalls++
        }
      }
    }

    const group = new SSEChannelGroup({ pubsub: mockPubSub })
    const ch1 = createSSEChannel()

    // Trigger register, then immediately deregister, then register again
    group.register(ch1, {}, { topics: ['topic-a'] })
    group.deregister(ch1)
    group.register(ch1, {}, { topics: ['topic-a'] })

    // Resolve the first subscribe call
    delayDeferred.resolve(undefined)
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    assert.strictEqual(subscribeCalls, 1)
    assert.strictEqual(unsubscribeCalls, 0)
  })

  await t.test('local-first publish ordering', async () => {
    const order: string[] = []
    const mockPubSub: PubSubAdapter = {
      publish: () => {
        order.push('broker-publish')
        return Promise.resolve()
      },
      subscribe: () => {
        return Promise.resolve(() => {})
      }
    }

    const group = new SSEChannelGroup({ pubsub: mockPubSub, eventBufferCapacity: 10 })
    const ch = createSSEChannel()
    group.register(ch, {}, { topics: ['topic-a'] })

    let capturedEventId: string | undefined = undefined
    // Mock invalidate to track execution and eventId propagation
    ch.invalidate = (_signal, eventId) => {
      capturedEventId = eventId
      order.push('local-invalidate')
      return eventId ?? ''
    }

    await group.publish('topic-a', { key: ['test'] })

    assert.deepStrictEqual(order, ['local-invalidate', 'broker-publish'])
    assert.equal(capturedEventId, '1')
  })

  await t.test('error isolation in subscribe chain', async () => {
    let errorForwarded: unknown = null
    let errorHandler: ((err: unknown) => void) | undefined
    const mockPubSub: PubSubAdapter = {
      publish: () => Promise.resolve(),
      subscribe: (topic) => {
        if (topic === '__restale_control__') return Promise.resolve(() => {})
        const err = new Error('Broker Connection Failed')
        if (errorHandler) {
          errorHandler(err)
        }
        return Promise.reject(err)
      },
      onError: (handler) => {
        errorHandler = handler
      }
    }

    if (mockPubSub.onError) {
      mockPubSub.onError((err) => {
        errorForwarded = err
      })
    }

    const group = new SSEChannelGroup({ pubsub: mockPubSub })
    const ch = createSSEChannel()

    group.register(ch, {}, { topics: ['topic-a'] })
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    // Verify error was caught and forwarded
    assert.ok(errorForwarded)
    if (errorForwarded instanceof Error) {
      assert.strictEqual(errorForwarded.message, 'Broker Connection Failed')
    } else {
      assert.fail('Error is not an instance of Error')
    }

    // Verify subsequent operation on same topic still works (retries subscription)
    let secondSubscribeCalled = false
    mockPubSub.subscribe = (topic) => {
      if (topic === '__restale_control__') return Promise.resolve(() => {})
      secondSubscribeCalled = true
      return Promise.resolve(() => {})
    }

    // Deregister then register again to retry subscription
    group.deregister(ch)
    group.register(ch, {}, { topics: ['topic-a'] })
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    assert.strictEqual(secondSubscribeCalled, true)
  })

  await t.test('unsubscribe error isolation and cleanup', async () => {
    let errorForwarded: unknown = null
    let errorHandler: ((err: unknown) => void) | undefined
    const mockPubSub: PubSubAdapter = {
      publish: () => Promise.resolve(),
      subscribe: (topic) => {
        if (topic === '__restale_control__') return Promise.resolve(() => {})
        return Promise.resolve(() => {
          const err = new Error('Broker Unsubscribe Failed')
          if (errorHandler) {
            errorHandler(err)
          }
          return Promise.reject(err)
        })
      },
      onError: (handler) => {
        errorHandler = handler
      }
    }

    if (mockPubSub.onError) {
      mockPubSub.onError((err) => {
        errorForwarded = err
      })
    }

    const group = new SSEChannelGroup({ pubsub: mockPubSub })
    const ch = createSSEChannel()

    group.register(ch, {}, { topics: ['topic-a'] })
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    group.deregister(ch)
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    // Verify error was forwarded
    assert.ok(errorForwarded)
    if (errorForwarded instanceof Error) {
      assert.strictEqual(errorForwarded.message, 'Broker Unsubscribe Failed')
    } else {
      assert.fail('Error is not an instance of Error')
    }

    // Verify the subscription state was still cleaned up
    let resubscribeCalled = false
    mockPubSub.subscribe = (topic) => {
      if (topic === '__restale_control__') return Promise.resolve(() => {})
      resubscribeCalled = true
      return Promise.resolve(() => {})
    }

    // Re-register: should trigger subscribe again (indicating we weren't left in zombie subscribed state)
    group.register(ch, {}, { topics: ['topic-a'] })
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    assert.strictEqual(resubscribeCalled, true)
  })

  await t.test('re-registration stale membership reconciliation', async () => {
    let subscribeCalls: string[] = []
    let unsubscribeCalls: string[] = []

    const mockPubSub: PubSubAdapter = {
      publish: () => Promise.resolve(),
      subscribe: (topic) => {
        if (topic !== '__restale_control__') {
          subscribeCalls.push(topic)
        }
        return Promise.resolve(() => {
          if (topic !== '__restale_control__') {
            unsubscribeCalls.push(topic)
          }
        })
      }
    }

    const group = new SSEChannelGroup({ pubsub: mockPubSub })
    const ch = createSSEChannel()

    // Register with topic-a and topic-b
    group.register(ch, {}, { topics: ['topic-a', 'topic-b'] })
    await new Promise(resolve => setTimeout(resolve, 15))

    assert.deepStrictEqual(subscribeCalls.sort(), ['topic-a', 'topic-b'])
    assert.deepStrictEqual(unsubscribeCalls, [])

    // Re-register with topic-b and topic-c (topic-a dropped, topic-b kept, topic-c added)
    subscribeCalls = []
    unsubscribeCalls = []
    group.register(ch, {}, { topics: ['topic-b', 'topic-c'] })
    await new Promise(resolve => setTimeout(resolve, 15))

    // topic-a should be unsubscribed, topic-c should be subscribed, topic-b should not change!
    assert.deepStrictEqual(subscribeCalls, ['topic-c'])
    assert.deepStrictEqual(unsubscribeCalls, ['topic-a'])

    // Deregister the channel completely
    subscribeCalls = []
    unsubscribeCalls = []
    group.deregister(ch)
    await new Promise(resolve => setTimeout(resolve, 15))

    // Should unsubscribe from topic-b and topic-c
    assert.deepStrictEqual(unsubscribeCalls.sort(), ['topic-b', 'topic-c'])
  })

  await t.test('bounded retry and backoff on failed subscribe', async () => {
    let attempts = 0
    const mockPubSub: PubSubAdapter = {
      publish: () => Promise.resolve(),
      subscribe: (topic) => {
        if (topic === '__restale_control__') return Promise.resolve(() => {})
        attempts++
        if (attempts < 3) {
          return Promise.reject(new Error('Transient connection error'))
        }
        return Promise.resolve(() => {})
      }
    }

    const group = new SSEChannelGroup({ pubsub: mockPubSub })
    const ch = createSSEChannel()

    group.register(ch, {}, { topics: ['topic-retry'] })
    
    // Wait for the retry loop to run (attempts should eventually succeed: 1st fails, sleep 100ms, 2nd fails, sleep 200ms, 3rd succeeds)
    await new Promise(resolve => setTimeout(resolve, 450))

    assert.strictEqual(attempts, 3) // First 2 failed, 3rd succeeded
  })

  await t.test('retry loop aborts when channels are deregistered', async () => {
    let attempts = 0
    const mockPubSub: PubSubAdapter = {
      publish: () => Promise.resolve(),
      subscribe: (topic) => {
        if (topic === '__restale_control__') return Promise.resolve(() => {})
        attempts++
        return Promise.reject(new Error('Transient connection error'))
      }
    }

    const group = new SSEChannelGroup({ pubsub: mockPubSub })
    const ch = createSSEChannel()

    group.register(ch, {}, { topics: ['topic-abort'] })
    
    // Allow the first attempt to fail and sleep to begin (100ms)
    await new Promise(resolve => setTimeout(resolve, 30))
    
    // Deregister the channel
    group.deregister(ch)
    
    // Wait some time to ensure no more attempts are made
    await new Promise(resolve => setTimeout(resolve, 350))

    assert.strictEqual(attempts, 1) // Only 1 attempt was made before aborting
  })
})

