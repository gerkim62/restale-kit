import { describe, it, expect, vi } from 'vitest'
import { SSEChannelGroup } from '@/server/core/channel-group.js'
import { createSSEChannel } from '@/server/core/channel.js'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'

describe('Code review fixes verification', () => {
  describe('SSEChannelGroup fixes', () => {
    it('dispose() closes all open channels registered in the group', async () => {
      const group = new SSEChannelGroup()
      const ch1 = createSSEChannel({})
      const ch2 = createSSEChannel({})
      const closeSpy1 = vi.spyOn(ch1, 'close')
      const closeSpy2 = vi.spyOn(ch2, 'close')

      group.register(ch1)
      group.register(ch2)
      expect(group.size).toBe(2)

      await group.dispose()

      expect(closeSpy1).toHaveBeenCalled()
      expect(closeSpy2).toHaveBeenCalled()
      expect(ch1.state).toBe('closed')
      expect(ch2.state).toBe('closed')
    })

    it('dispose() continues cleanup if controlUnsubscribe throws', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockPubsub = {
        publish: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn((topic: string) => {
          if (topic === '__restale_control__') {
            return Promise.resolve(() => Promise.reject(new Error('Control unsub failed')))
          }
          return Promise.resolve(vi.fn().mockResolvedValue(undefined))
        }),
      }

      const group = new SSEChannelGroup({ pubsub: mockPubsub })
      const ch = createSSEChannel({})
      group.register(ch, undefined, { topics: ['chat'] })

      // Wait for subscriptions to resolve
      for (let i = 0; i < 5; i++) await Promise.resolve()

      await expect(group.dispose()).resolves.toBeUndefined()

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SSEChannelGroup] Failed to unsubscribe control subscriber during dispose:'),
        expect.any(Error),
      )
      expect(ch.state).toBe('closed')
      consoleErrorSpy.mockRestore()
    })

    it('serializes async unsubscription before re-subscribing to the same topic', async () => {
      const executionOrder: string[] = []
      let resolveUnsub!: () => void
      const unsubPromise = new Promise<void>((r) => { resolveUnsub = r })

      const mockPubsub = {
        publish: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn((topic: string) => {
          if (topic === 'chat') executionOrder.push(`subscribe:${topic}`)
          return Promise.resolve(async () => {
            if (topic === 'chat') executionOrder.push(`start-unsubscribe:${topic}`)
            await unsubPromise
            if (topic === 'chat') executionOrder.push(`finish-unsubscribe:${topic}`)
          })
        }),
      }

      const group = new SSEChannelGroup({ pubsub: mockPubsub })
      const ch1 = createSSEChannel({})
      group.register(ch1, undefined, { topics: ['chat'] })

      // Wait for initial subscription to fully resolve and register in topicUnsubscribers
      for (let i = 0; i < 5; i++) await Promise.resolve()
      expect(executionOrder).toEqual(['subscribe:chat'])

      // Detach ch1 -> triggers async unsubscription
      group.deregister(ch1)
      expect(executionOrder).toEqual(['subscribe:chat', 'start-unsubscribe:chat'])

      // Immediately register ch2 on the same topic while unsubscribe is still pending
      const ch2 = createSSEChannel({})
      group.register(ch2, undefined, { topics: ['chat'] })

      // Verify that subscribe was not called while unsubscribe was in-flight
      expect(executionOrder).toEqual(['subscribe:chat', 'start-unsubscribe:chat'])

      // Complete unsubscription
      resolveUnsub()
      await unsubPromise
      await Promise.resolve()
      await Promise.resolve()

      // Now subscribe:chat must have run after finish-unsubscribe:chat
      expect(executionOrder).toEqual([
        'subscribe:chat',
        'start-unsubscribe:chat',
        'finish-unsubscribe:chat',
        'subscribe:chat',
      ])
    })
  })

  describe('SSEInvalidatorClient fixes', () => {
    it('close() clears lastEventId and connectionId', () => {
      const client = new SSEInvalidatorClient('/api/sse')
      // Simulate connected state
      // @ts-expect-error accessing private property for test verification
      client.currentLastEventId = 'evt-123'
      // @ts-expect-error accessing private property for test verification
      client.currentConnectionId = 'conn-456'

      client.close()

      expect(client.lastEventId).toBeNull()
      expect(client.connectionId).toBeUndefined()
      expect(client.status).toEqual({ status: 'closed', reason: 'manual' })
    })

    it('closeWithUnmount() clears lastEventId and connectionId', () => {
      const client = new SSEInvalidatorClient('/api/sse')
      // @ts-expect-error accessing private property for test verification
      client.currentLastEventId = 'evt-999'
      // @ts-expect-error accessing private property for test verification
      client.currentConnectionId = 'conn-999'

      client.closeWithUnmount()

      expect(client.lastEventId).toBeNull()
      expect(client.connectionId).toBeUndefined()
      expect(client.status).toEqual({ status: 'closed', reason: 'unmount' })
    })
  })
})
