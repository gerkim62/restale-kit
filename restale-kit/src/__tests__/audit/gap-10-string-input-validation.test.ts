/**
 * Gap 10: String inputs that are too broad for runtime invariants
 * 
 * String inputs that are explicitly rejected or unsafe at runtime remain plain string.
 * Affected APIs include:
 * - SSEChannelGroup.publish(topic, ...)
 * - ChannelSetupOptions.topics
 * - register(..., { topics })
 * - controlTopic
 * - revokeByConnectionId(connectionId, ...)
 * - encrypted pub/sub operations (blank topic values throw during AAD setup)
 */

import { describe, it, expect } from 'vitest'
import { SSEChannelGroup } from '@/server/core/index.js'
import { createSSEChannel } from '@/testing/index.js'
import type { SWRSignal } from '@/types/index.js'

describe('Gap 10: String input validation for runtime invariants', () => {
  describe('SSEChannelGroup.publish topic validation', () => {
    it('should reject empty string topic', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('', { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })

    it('should reject whitespace-only topic', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('   ', { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })

    it('should reject topic with only tabs and newlines', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('\t\n\r', { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })

    it('should accept valid non-empty topic', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('valid-topic', { target: 'swr', key: ['test'] })
      ).resolves.not.toThrow()
    })

    it('should accept topic with leading/trailing spaces if not all whitespace', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      // Topic with spaces but contains non-whitespace content
      await expect(
        group.publish(' valid-topic ', { target: 'swr', key: ['test'] })
      ).resolves.not.toThrow()
    })

    it('should handle unicode whitespace characters', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      // Unicode non-breaking space and other whitespace
      await expect(
        group.publish('\u00A0\u2000\u2001', { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })
  })

  describe('ChannelSetupOptions.topics validation', () => {
    it('should reject empty string in topics array', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const mockRequest = new Request('http://localhost/sse')
      
      expect(() => {
        group.createFetchResponse(mockRequest, {
          target: 'swr',
          topics: ['']
        })
      }).toThrow()
    })

    it('should reject whitespace-only string in topics array', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const mockRequest = new Request('http://localhost/sse')
      
      expect(() => {
        group.createFetchResponse(mockRequest, {
          target: 'swr',
          topics: ['   ']
        })
      }).toThrow()
    })

    it('should reject topics array with mix of valid and invalid', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const mockRequest = new Request('http://localhost/sse')
      
      expect(() => {
        group.createFetchResponse(mockRequest, {
          target: 'swr',
          topics: ['valid-topic', '', 'another-valid']
        })
      }).toThrow()
    })

    it('should accept valid topics array', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const mockRequest = new Request('http://localhost/sse')
      
      expect(() => {
        group.createFetchResponse(mockRequest, {
          target: 'swr',
          topics: ['topic1', 'topic2', 'topic3']
        })
      }).not.toThrow()
    })

    it('should accept empty topics array', () => {
      const group = new SSEChannelGroup<SWRSignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      expect(() => {
        group.createFetchResponse(mockRequest, {
          target: 'swr',
          topics: []
        })
      }).not.toThrow()
    })

    it('should accept undefined topics', () => {
      const group = new SSEChannelGroup<SWRSignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      expect(() => {
        group.createFetchResponse(mockRequest, {
          target: 'swr'
        })
      }).not.toThrow()
    })
  })

  describe('SSEChannelGroup.register topics validation', () => {
    it('should reject empty string in topics option', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        group.register(channel, undefined, { topics: [''] })
      }).toThrow()
    })

    it('should reject whitespace-only string in topics option', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        group.register(channel, undefined, { topics: ['\t\n'] })
      }).toThrow()
    })

    it('should accept valid topics in register', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        group.register(channel, undefined, { topics: ['updates', 'notifications'] })
      }).not.toThrow()
    })
  })

  describe('controlTopic validation', () => {
    it('should reject empty string controlTopic', () => {
      expect(() => {
        new SSEChannelGroup<SWRSignal>({
          controlTopic: ''
        })
      }).toThrow(/controlTopic.*non-empty/i)
    })

    it('should reject whitespace-only controlTopic', () => {
      expect(() => {
        new SSEChannelGroup<SWRSignal>({
          controlTopic: '   '
        })
      }).toThrow(/controlTopic.*non-empty/i)
    })

    it('should reject controlTopic with only tabs', () => {
      expect(() => {
        new SSEChannelGroup<SWRSignal>({
          controlTopic: '\t\t\t'
        })
      }).toThrow(/controlTopic.*non-empty/i)
    })

    it('should accept valid controlTopic', () => {
      expect(() => {
        new SSEChannelGroup<SWRSignal>({
          controlTopic: 'custom-control-topic'
        })
      }).not.toThrow()
    })

    it('should use default controlTopic when not provided', () => {
      const group = new SSEChannelGroup<SWRSignal>()
      
      expect(group.controlTopic).toBeDefined()
      expect(typeof group.controlTopic).toBe('string')
      expect(group.controlTopic.trim()).not.toBe('')
    })
  })

  describe('revokeByConnectionId connectionId validation', () => {
    it('should reject empty string connectionId', async () => {
      const group = new SSEChannelGroup<SWRSignal>()
      
      await expect(
        group.revokeByConnectionId('')
      ).rejects.toThrow(/connectionId.*non-empty/i)
    })

    it('should reject whitespace-only connectionId', async () => {
      const group = new SSEChannelGroup<SWRSignal>()
      
      await expect(
        group.revokeByConnectionId('   ')
      ).rejects.toThrow(/connectionId.*non-empty/i)
    })

    it('should reject connectionId with only tabs and newlines', async () => {
      const group = new SSEChannelGroup<SWRSignal>()
      
      await expect(
        group.revokeByConnectionId('\t\n\r')
      ).rejects.toThrow(/connectionId.*non-empty/i)
    })

    it('should accept valid connectionId', async () => {
      const group = new SSEChannelGroup<SWRSignal>()
      
      await expect(
        group.revokeByConnectionId('valid-connection-id')
      ).resolves.toMatchObject({ closed: false })
    })

    it('should accept connectionId with special characters', async () => {
      const group = new SSEChannelGroup<SWRSignal>()
      
      await expect(
        group.revokeByConnectionId('conn-123-abc-xyz')
      ).resolves.toMatchObject({ closed: false })
    })

    it('should reject empty connectionId even with valid scope', async () => {
      const group = new SSEChannelGroup<SWRSignal>()
      
      await expect(
        group.revokeByConnectionId('', { userId: 123 })
      ).rejects.toThrow(/connectionId.*non-empty/i)
    })

    it('should accept valid connectionId with scope', async () => {
      const group = new SSEChannelGroup<SWRSignal>()
      
      await expect(
        group.revokeByConnectionId('conn-123', { userId: 123 })
      ).resolves.toMatchObject({ closed: false })
    })
  })

  describe('Encrypted pub/sub topic validation', () => {
    it('should reject empty topic for encrypted publish', async () => {
      const encryptionKey = 'a'.repeat(64) // Valid hex key
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: {
          type: 'memory',
          encryptionKey
        }
      })
      
      await expect(
        group.publish('', { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })

    it('should reject whitespace topic for encrypted publish', async () => {
      const encryptionKey = 'a'.repeat(64) // Valid hex key
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: {
          type: 'memory',
          encryptionKey
        }
      })
      
      await expect(
        group.publish('   ', { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })

    it('should accept valid topic for encrypted publish', async () => {
      const encryptionKey = 'a'.repeat(64) // Valid hex key
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: {
          type: 'memory',
          encryptionKey
        }
      })
      
      await expect(
        group.publish('encrypted-topic', { target: 'swr', key: ['test'] })
      ).resolves.not.toThrow()
    })
  })

  describe('Edge cases with special characters', () => {
    it('should accept topic with hyphens and underscores', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('my-topic_123', { target: 'swr', key: ['test'] })
      ).resolves.not.toThrow()
    })

    it('should accept topic with dots and slashes', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('my.topic/updates', { target: 'swr', key: ['test'] })
      ).resolves.not.toThrow()
    })

    it('should accept topic with numbers', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('topic123', { target: 'swr', key: ['test'] })
      ).resolves.not.toThrow()
    })

    it('should handle very long valid topics', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      const longTopic = 'a'.repeat(1000)
      
      await expect(
        group.publish(longTopic, { target: 'swr', key: ['test'] })
      ).resolves.not.toThrow()
    })

    it('should reject topic that is only zero-width characters', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      // Zero-width space
      await expect(
        group.publish('\u200B\u200C\u200D', { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })
  })

  describe('Topics in attachNodeResponse', () => {
    it('should reject empty string in topics', () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const mockReq = {} as any
      const mockRes = {} as any
      
      expect(() => {
        group.attachNodeResponse(mockReq, mockRes, {
          target: 'swr',
          topics: ['valid', '', 'another']
        })
      }).toThrow()
    })

    it('should accept valid topics in attachNodeResponse', () => {
      const group = new SSEChannelGroup<SWRSignal>()
      const mockReq = {} as any
      const mockRes = {} as any
      
      expect(() => {
        group.attachNodeResponse(mockReq, mockRes, {
          target: 'swr',
          topics: ['topic1', 'topic2']
        })
      }).not.toThrow()
    })
  })

  describe('Validation consistency across APIs', () => {
    it('should use same validation for topics in all APIs', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const mockRequest = new Request('http://localhost/sse')
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      const invalidTopic = '   '
      
      // All should reject the same invalid input
      expect(() => {
        group.createFetchResponse(mockRequest, {
          target: 'swr',
          topics: [invalidTopic]
        })
      }).toThrow()
      
      expect(() => {
        group.register(channel, undefined, { topics: [invalidTopic] })
      }).toThrow()
      
      await expect(
        group.publish(invalidTopic, { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })

    it('should accept same valid input across all APIs', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const mockRequest = new Request('http://localhost/sse')
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      const validTopic = 'my-valid-topic'
      
      // All should accept the same valid input
      expect(() => {
        group.createFetchResponse(mockRequest, {
          target: 'swr',
          topics: [validTopic]
        })
      }).not.toThrow()
      
      const channel2 = createSSEChannel<SWRSignal>({ target: 'swr' })
      expect(() => {
        group.register(channel2, undefined, { topics: [validTopic] })
      }).not.toThrow()
      
      await expect(
        group.publish(validTopic, { target: 'swr', key: ['test'] })
      ).resolves.not.toThrow()
    })
  })

  describe('Runtime type coercion edge cases', () => {
    it('should reject null coerced to string', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish(null as any, { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })

    it('should reject undefined coerced to string', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish(undefined as any, { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })

    it('should reject number coerced to string', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish(123 as any, { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })

    it('should reject object coerced to string', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish({} as any, { target: 'swr', key: ['test'] })
      ).rejects.toThrow()
    })
  })
})
