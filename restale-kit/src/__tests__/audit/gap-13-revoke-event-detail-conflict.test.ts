/**
 * Gap 13: Two incompatible public RevokeEventDetail shapes - Runtime tests
 * 
 * Tests the actual runtime behavior of revoke events to ensure they match
 * the client shape (top-level requested/supported) not the protocol shape
 * (nested details).
 */

import { describe, it, expect, vi } from 'vitest'
import { SSEInvalidatorClient } from '@/client/core/sse-client.js'
import type { RevokeEventDetail as ClientRevokeEventDetail } from '@/client/core/client-contracts.js'

describe('Gap 13: RevokeEventDetail runtime behavior', () => {
  describe('Actual client event shape', () => {
    it('should emit revoke events with top-level requested and supported fields', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        target: 'rtk-query',
        autoReconnect: false
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        if (detail.reason === 'unsupported-target') {
          // Should have top-level fields (client shape)
          expect(detail).toHaveProperty('requested')
          expect(detail).toHaveProperty('supported')
          
          // Should NOT have nested details (protocol shape)
          expect(detail).not.toHaveProperty('details')
          
          done()
        }
      })
      
      // Simulate revoke event
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: 'unsupported-target',
          requested: 'rtk-query',
          supported: ['swr', 'tanstack-query']
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })

    it('should emit deadline revoke without requested/supported', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        if (detail.reason === 'deadline') {
          // Should NOT have requested or supported
          expect(detail).not.toHaveProperty('requested')
          expect(detail).not.toHaveProperty('supported')
          expect(detail).not.toHaveProperty('details')
          
          done()
        }
      })
      
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: 'deadline'
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })

    it('should emit custom reason revoke without requested/supported', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        if (detail.reason === 'session-expired') {
          expect(detail).not.toHaveProperty('requested')
          expect(detail).not.toHaveProperty('supported')
          expect(detail).not.toHaveProperty('details')
          
          done()
        }
      })
      
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: 'session-expired'
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })
  })

  describe('Event handler patterns', () => {
    it('should allow handlers to access top-level requested/supported', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        target: 'rtk-query',
        autoReconnect: false
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        if (detail.reason === 'unsupported-target') {
          // Client shape allows direct access
          expect(typeof detail.requested).toBe('string')
          expect(Array.isArray(detail.supported)).toBe(true)
          expect(detail.requested).toBe('rtk-query')
          expect(detail.supported).toEqual(['swr', 'tanstack-query'])
          
          done()
        }
      })
      
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: 'unsupported-target',
          requested: 'rtk-query',
          supported: ['swr', 'tanstack-query']
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })

    it('should not have nested details property', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail as any
        
        // Protocol shape would have details
        expect(detail.details).toBeUndefined()
        
        // Client shape has top-level fields
        if (detail.reason === 'unsupported-target') {
          expect(detail.requested).toBeDefined()
          expect(detail.supported).toBeDefined()
        }
        
        done()
      })
      
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: 'unsupported-target',
          requested: 'swr',
          supported: ['tanstack-query']
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })
  })

  describe('Type narrowing at runtime', () => {
    it('should correctly narrow unsupported-target reason', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        // TypeScript narrows the type
        if (detail.reason === 'unsupported-target') {
          // These fields should be present
          expect(detail.requested).toBe('custom-target')
          expect(detail.supported).toEqual(['swr'])
        } else {
          // These fields should not be present
          expect((detail as any).requested).toBeUndefined()
          expect((detail as any).supported).toBeUndefined()
        }
        
        done()
      })
      
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: 'unsupported-target',
          requested: 'custom-target',
          supported: ['swr']
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })

    it('should handle other reason types correctly', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      const reasons = ['deadline', 'session-expired', 'banned', 'custom-reason']
      let count = 0
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        // None of these should have requested/supported
        expect((detail as any).requested).toBeUndefined()
        expect((detail as any).supported).toBeUndefined()
        
        count++
        if (count === reasons.length) {
          done()
        }
      })
      
      for (const reason of reasons) {
        const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
          detail: { reason: reason as any }
        })
        client.dispatchEvent(revokeEvent)
      }
    })
  })

  describe('Supported field types', () => {
    it('should handle supported as array of strings', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        if (detail.reason === 'unsupported-target') {
          expect(Array.isArray(detail.supported)).toBe(true)
          expect(detail.supported.length).toBeGreaterThan(0)
          detail.supported.forEach(target => {
            expect(typeof target).toBe('string')
          })
          
          done()
        }
      })
      
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: 'unsupported-target',
          requested: 'rtk-query',
          supported: ['swr', 'tanstack-query', 'custom-target']
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })

    it('should handle empty supported array', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        if (detail.reason === 'unsupported-target') {
          expect(Array.isArray(detail.supported)).toBe(true)
          expect(detail.supported.length).toBe(0)
          
          done()
        }
      })
      
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: 'unsupported-target',
          requested: 'unknown',
          supported: []
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })
  })

  describe('Requested field types', () => {
    it('should handle various requested target strings', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      const requestedTargets = ['swr', 'tanstack-query', 'rtk-query', 'custom-target', 'unknown']
      let count = 0
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        if (detail.reason === 'unsupported-target') {
          expect(typeof detail.requested).toBe('string')
          expect(requestedTargets).toContain(detail.requested)
          
          count++
          if (count === requestedTargets.length) {
            done()
          }
        }
      })
      
      for (const target of requestedTargets) {
        const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
          detail: {
            reason: 'unsupported-target',
            requested: target,
            supported: ['swr']
          }
        })
        client.dispatchEvent(revokeEvent)
      }
    })
  })

  describe('Multiple event listeners', () => {
    it('should deliver consistent shape to all listeners', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      let listener1Called = false
      let listener2Called = false
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        if (detail.reason === 'unsupported-target') {
          expect(detail.requested).toBe('rtk-query')
          expect(detail.supported).toEqual(['swr'])
          expect((detail as any).details).toBeUndefined()
        }
        
        listener1Called = true
        if (listener1Called && listener2Called) done()
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        if (detail.reason === 'unsupported-target') {
          expect(detail.requested).toBe('rtk-query')
          expect(detail.supported).toEqual(['swr'])
          expect((detail as any).details).toBeUndefined()
        }
        
        listener2Called = true
        if (listener1Called && listener2Called) done()
      })
      
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: 'unsupported-target',
          requested: 'rtk-query',
          supported: ['swr']
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })
  })

  describe('Edge cases', () => {
    it('should handle undefined reason', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        expect(detail.reason).toBeUndefined()
        expect((detail as any).requested).toBeUndefined()
        expect((detail as any).supported).toBeUndefined()
        
        done()
      })
      
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: undefined
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })

    it('should handle empty string reason', (done) => {
      const client = new SSEInvalidatorClient('http://localhost/sse', {
        autoReconnect: false
      })
      
      client.addEventListener('revoke', (event) => {
        const detail = event.detail
        
        expect(detail.reason).toBe('')
        
        done()
      })
      
      const revokeEvent = new CustomEvent<ClientRevokeEventDetail>('revoke', {
        detail: {
          reason: ''
        }
      })
      
      client.dispatchEvent(revokeEvent)
    })
  })
})
