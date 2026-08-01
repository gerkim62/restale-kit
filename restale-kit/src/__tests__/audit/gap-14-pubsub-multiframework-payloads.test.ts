/**
 * Gap 14: PubSub signal payload validation fails for multi-framework signals
 *
 * isSignalPayload in pubsub-utils currently checks only `item['key']` (SWR-style signals).
 * Signals for TanStack Query (`queryKey`) and RTK Query (`tags`) are rejected by
 * `isSignalPayload`, causing pubsub adapters (Redis, Ably, Pusher) to drop non-SWR signals.
 */

import { describe, test, expect } from 'vitest'
import { isSignalPayload, isPubSubMessage } from '../../pubsub/core/pubsub-utils.js'

describe('Gap 14: PubSub multi-framework signal payload validation', () => {
  describe('isSignalPayload with TanStack Query signals', () => {
    test('should accept single TanStack Query signal', () => {
      const signal = { target: 'tanstack-query', queryKey: ['todos', { status: 'active' }] }
      expect(isSignalPayload(signal)).toBe(true)
    })

    test('should accept batch of TanStack Query signals', () => {
      const batch = [
        { target: 'tanstack-query', queryKey: ['todos'] },
        { target: 'tanstack-query', queryKey: ['users', 1] }
      ]
      expect(isSignalPayload(batch)).toBe(true)
    })
  })

  describe('isSignalPayload with RTK Query signals', () => {
    test('should accept single RTK Query signal', () => {
      const signal = { target: 'rtk-query', tags: [{ type: 'Posts', id: 'LIST' }] }
      expect(isSignalPayload(signal)).toBe(true)
    })

    test('should accept batch of RTK Query signals', () => {
      const batch = [
        { target: 'rtk-query', tags: [{ type: 'User', id: 42 }] },
        { target: 'rtk-query', tags: [{ type: 'Post' }] }
      ]
      expect(isSignalPayload(batch)).toBe(true)
    })
  })

  describe('isPubSubMessage with multi-framework payloads', () => {
    test('should accept pubsub message containing TanStack Query signal', () => {
      const message = {
        kind: 'signal',
        data: { target: 'tanstack-query', queryKey: ['items'] }
      }
      expect(isPubSubMessage(message)).toBe(true)
    })

    test('should accept pubsub message containing RTK Query signal', () => {
      const message = {
        kind: 'signal',
        data: { target: 'rtk-query', tags: [{ type: 'Settings' }] }
      }
      expect(isPubSubMessage(message)).toBe(true)
    })
  })
})
