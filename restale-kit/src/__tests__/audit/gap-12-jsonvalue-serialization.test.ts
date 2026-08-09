/**
 * Gap 12: JSONValue is not fully aligned with "survives JSON round-trip losslessly"
 * 
 * JSONValue includes number, hence accepts NaN and infinities statically;
 * JSON serializes them as null. RTK tag IDs have the same issue through id?: number.
 * This causes runtime issues when non-finite numbers appear in keys or RTK IDs
 * before framing/publishing.
 */

import { describe, it, expect } from 'vitest'
import { createSSEChannel } from '@/testing/index.js'
import { validatePayload } from '@/client/core/validation.js'
import { SSEChannelGroup } from '@/server/core/index.js'
import type { SWRSignal, RTKQuerySignal, TanStackQuerySignal } from '@/types/index.js'

describe('Gap 12: JSONValue serialization with non-finite numbers', () => {
  describe('Signal key validation with NaN', () => {
    it('should reject NaN in SWR signal key', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: [NaN]
        })
      }).toThrow()
    })

    it('should reject NaN in nested SWR key', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['users', NaN, 'profile']
        })
      }).toThrow()
    })

    it('should reject NaN in TanStack queryKey', () => {
      const channel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'tanstack-query',
          queryKey: ['todos', NaN]
        })
      }).toThrow()
    })

    it('should reject NaN in object within key', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['posts', { userId: NaN }]
        })
      }).toThrow()
    })
  })

  describe('Signal key validation with Infinity', () => {
    it('should reject Infinity in SWR signal key', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: [Infinity]
        })
      }).toThrow()
    })

    it('should reject negative Infinity in SWR key', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: [-Infinity]
        })
      }).toThrow()
    })

    it('should reject Infinity in TanStack queryKey', () => {
      const channel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'tanstack-query',
          queryKey: ['items', Infinity]
        })
      }).toThrow()
    })

    it('should reject Infinity in nested object', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['data', { limit: Infinity }]
        })
      }).toThrow()
    })
  })

  describe('Valid finite numbers in keys', () => {
    it('should accept valid finite numbers in SWR key', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: [42, -7, 0, 3.14]
        })
      }).not.toThrow()
    })

    it('should accept valid numbers in TanStack queryKey', () => {
      const channel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'tanstack-query',
          queryKey: ['users', 123, 'posts', 456]
        })
      }).not.toThrow()
    })

    it('should accept finite numbers in nested objects', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['data', { page: 1, limit: 20 }]
        })
      }).not.toThrow()
    })

    it('should accept negative finite numbers', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: [-1, -42, -3.14]
        })
      }).not.toThrow()
    })

    it('should accept zero in keys', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: [0, -0]
        })
      }).not.toThrow()
    })
  })

  describe('RTK tag ID validation', () => {
    it('should reject NaN in RTK tag ID', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'rtk-query',
          tags: [{ type: 'User', id: NaN }]
        })
      }).toThrow()
    })

    it('should reject Infinity in RTK tag ID', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'rtk-query',
          tags: [{ type: 'Post', id: Infinity }]
        })
      }).toThrow()
    })

    it('should reject negative Infinity in RTK tag ID', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'rtk-query',
          tags: [{ type: 'Comment', id: -Infinity }]
        })
      }).toThrow()
    })

    it('should accept valid numeric RTK tag ID', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'rtk-query',
          tags: [{ type: 'User', id: 42 }]
        })
      }).not.toThrow()
    })

    it('should accept zero as RTK tag ID', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'rtk-query',
          tags: [{ type: 'Item', id: 0 }]
        })
      }).not.toThrow()
    })

    it('should accept negative RTK tag ID', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'rtk-query',
          tags: [{ type: 'Entity', id: -1 }]
        })
      }).not.toThrow()
    })

    it('should accept string RTK tag ID', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'rtk-query',
          tags: [{ type: 'User', id: 'uuid-123' }]
        })
      }).not.toThrow()
    })

    it('should accept RTK tag without ID', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'rtk-query',
          tags: [{ type: 'Todo' }]
        })
      }).not.toThrow()
    })

    it('should reject NaN in multiple tags', () => {
      const channel = createSSEChannel<RTKQuerySignal>({ target: 'rtk-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'rtk-query',
          tags: [
            { type: 'User', id: 1 },
            { type: 'Post', id: NaN }
          ]
        })
      }).toThrow()
    })
  })

  describe('Client-side payload validation', () => {
    it('should reject payload with NaN in key when parsed from JSON string', () => {
      // Direct object with NaN (simulating parsed payload)
      expect(() => {
        validatePayload({ key: [NaN] })
      }).toThrow()
    })

    it('should reject payload with Infinity in key', () => {
      expect(() => {
        validatePayload({ key: [Infinity] })
      }).toThrow()
    })

    it('should reject payload with negative Infinity in key', () => {
      expect(() => {
        validatePayload({ key: [-Infinity] })
      }).toThrow()
    })

    it('should accept payload with valid finite numbers', () => {
      const payload = JSON.stringify({ key: [42, -7, 0, 3.14] })
      expect(() => {
        validatePayload(payload)
      }).not.toThrow()
    })

    it('should accept payload with null, string, boolean in key', () => {
      const payload = JSON.stringify({ key: ['users', null, true, false] })
      expect(() => {
        validatePayload(payload)
      }).not.toThrow()
    })
  })

  describe('JSON serialization behavior', () => {
    it('should demonstrate NaN serializes to null', () => {
      const obj = { value: NaN }
      const serialized = JSON.stringify(obj)
      const parsed = JSON.parse(serialized)
      
      expect(serialized).toBe('{"value":null}')
      expect(parsed.value).toBe(null)
      expect(parsed.value).not.toBe(NaN)
    })

    it('should demonstrate Infinity serializes to null', () => {
      const obj = { value: Infinity }
      const serialized = JSON.stringify(obj)
      const parsed = JSON.parse(serialized)
      
      expect(serialized).toBe('{"value":null}')
      expect(parsed.value).toBe(null)
    })

    it('should demonstrate negative Infinity serializes to null', () => {
      const obj = { value: -Infinity }
      const serialized = JSON.stringify(obj)
      const parsed = JSON.parse(serialized)
      
      expect(serialized).toBe('{"value":null}')
      expect(parsed.value).toBe(null)
    })

    it('should demonstrate finite numbers round-trip correctly', () => {
      const obj = { value: 42 }
      const serialized = JSON.stringify(obj)
      const parsed = JSON.parse(serialized)
      
      expect(parsed.value).toBe(42)
    })
  })

  describe('Publishing with non-finite numbers', () => {
    it('should reject publishing signal with NaN in key', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('topic', {
          target: 'swr',
          key: ['users', NaN]
        })
      ).rejects.toThrow()
    })

    it('should reject publishing signal with Infinity in key', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('topic', {
          target: 'swr',
          key: [Infinity, 'data']
        })
      ).rejects.toThrow()
    })

    it('should reject publishing RTK signal with NaN in tag ID', async () => {
      const group = new SSEChannelGroup<RTKQuerySignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('topic', {
          target: 'rtk-query',
          tags: [{ type: 'User', id: NaN }]
        })
      ).rejects.toThrow()
    })

    it('should accept publishing signal with valid finite numbers', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      
      await expect(
        group.publish('topic', {
          target: 'swr',
          key: ['users', 42, 'profile']
        })
      ).resolves.not.toThrow()
    })
  })

  describe('Broadcasting with non-finite numbers', () => {
    it('should reject broadcasting signal with NaN', () => {
      const group = new SSEChannelGroup<SWRSignal>()
      
      expect(() => {
        group.broadcastToAll({
          target: 'swr',
          key: [NaN]
        })
      }).toThrow()
    })

    it('should reject broadcasting signal with Infinity', () => {
      const group = new SSEChannelGroup<TanStackQuerySignal>()
      
      expect(() => {
        group.broadcastToAll({
          target: 'tanstack-query',
          queryKey: ['items', Infinity]
        })
      }).toThrow()
    })

    it('should accept broadcasting signal with valid numbers', () => {
      const group = new SSEChannelGroup<SWRSignal>()
      
      expect(() => {
        group.broadcastToAll({
          target: 'swr',
          key: ['users', 123]
        })
      }).not.toThrow()
    })
  })

  describe('Nested structures with non-finite numbers', () => {
    it('should reject deeply nested NaN', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['data', { nested: { value: NaN } }]
        })
      }).toThrow()
    })

    it('should reject NaN in array within object', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['users', { ids: [1, 2, NaN, 4] }]
        })
      }).toThrow()
    })

    it('should reject Infinity in nested array', () => {
      const channel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      
      expect(() => {
        channel.invalidate({
          target: 'tanstack-query',
          queryKey: [['posts', [Infinity]]]
        })
      }).toThrow()
    })

    it('should accept deeply nested finite numbers', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['data', { nested: { value: 42 } }]
        })
      }).not.toThrow()
    })
  })

  describe('Edge cases with special number values', () => {
    it('should accept Number.MAX_SAFE_INTEGER', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['data', Number.MAX_SAFE_INTEGER]
        })
      }).not.toThrow()
    })

    it('should accept Number.MIN_SAFE_INTEGER', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['data', Number.MIN_SAFE_INTEGER]
        })
      }).not.toThrow()
    })

    it('should accept Number.MAX_VALUE', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['data', Number.MAX_VALUE]
        })
      }).not.toThrow()
    })

    it('should accept Number.MIN_VALUE', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['data', Number.MIN_VALUE]
        })
      }).not.toThrow()
    })

    it('should accept Number.EPSILON', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: ['data', Number.EPSILON]
        })
      }).not.toThrow()
    })

    it('should handle positive and negative zero correctly', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate({
          target: 'swr',
          key: [0, -0]
        })
      }).not.toThrow()
      
      // Note: JSON doesn't distinguish +0 from -0
      expect(JSON.parse(JSON.stringify({ a: 0, b: -0 }))).toEqual({ a: 0, b: 0 })
    })
  })

  describe('Validation consistency across operations', () => {
    it('should use same validation for invalidate and publish', async () => {
      const group = new SSEChannelGroup<SWRSignal>({
        pubsub: { type: 'memory' }
      })
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      const invalidSignal = { target: 'swr' as const, key: [NaN] }
      
      // Both should reject
      expect(() => {
        channel.invalidate(invalidSignal)
      }).toThrow()
      
      await expect(
        group.publish('topic', invalidSignal)
      ).rejects.toThrow()
    })

    it('should use same validation for broadcast and invalidate', () => {
      const group = new SSEChannelGroup<SWRSignal>()
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      const invalidSignal = { target: 'swr' as const, key: [Infinity] }
      
      // Both should reject
      expect(() => {
        channel.invalidate(invalidSignal)
      }).toThrow()
      
      expect(() => {
        group.broadcastToAll(invalidSignal)
      }).toThrow()
    })
  })

  describe('Array of signals with non-finite numbers', () => {
    it('should reject batch with one signal containing NaN', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate([
          { target: 'swr', key: ['valid'] },
          { target: 'swr', key: [NaN] },
          { target: 'swr', key: ['also-valid'] }
        ])
      }).toThrow()
    })

    it('should accept batch with all valid finite numbers', () => {
      const channel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      expect(() => {
        channel.invalidate([
          { target: 'swr', key: [1] },
          { target: 'swr', key: [2] },
          { target: 'swr', key: [3] }
        ])
      }).not.toThrow()
    })
  })
})
