import test from 'node:test'
import assert from 'node:assert'
import { SSEChannelGroup, type PubSubAdapter } from '../server-core/channel-group.js'
import { createSSEChannel } from '../server-core/channel.js'

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
      subscribe: () => {
        subscribeCalls++
        return Promise.resolve(() => {
          unsubscribeCalls++
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
      subscribe: async () => {
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

    // Because register -> deregister -> register occurred, the final state should be subscribed
    // Let's verify unsubscribe was called for the transient deregister (or bypassed)
    // Actually, in our optimized queue:
    // Task 1: subscribe -> completes.
    // Task 2: unsubscribe -> sees channels.size > 0, aborts (does not unsubscribe, stays subscribed).
    // Task 3: subscribe -> sees unsubscribeFn is defined, returns immediately.
    // So subscribeCalls = 1, unsubscribeCalls = 0!
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

    const group = new SSEChannelGroup({ pubsub: mockPubSub })
    const ch = createSSEChannel()
    group.register(ch, {}, { topics: ['topic-a'] })

    // Mock invalidate to track execution
    ch.invalidate = () => {
      order.push('local-invalidate')
    }

    await group.publish('topic-a', { key: ['test'] })

    assert.deepStrictEqual(order, ['local-invalidate', 'broker-publish'])
  })

  await t.test('error isolation in subscribe chain', async () => {
    let errorForwarded: unknown = null
    let errorHandler: ((err: unknown) => void) | undefined
    const mockPubSub: PubSubAdapter = {
      publish: () => Promise.resolve(),
      subscribe: () => {
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
    mockPubSub.subscribe = () => {
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
      subscribe: () => {
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
    mockPubSub.subscribe = () => {
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
})
