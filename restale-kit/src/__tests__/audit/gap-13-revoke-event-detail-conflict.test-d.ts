/**
 * Gap 13: Two incompatible public RevokeEventDetail shapes exist
 * 
 * Root/types export: protocol.ts (line 349), using nested `details`.
 * Client export: client-contracts.ts (line 144), using top-level `requested` and `supported`.
 * 
 * The actual client event uses the client shape. Importing the same named type
 * from the root gives users a contradictory public contract.
 */

import { describe, expectTypeOf, test } from 'vitest'
import { RevokeEventDetail as ProtocolRevokeEventDetail } from '@/types/protocol.js'
import { RevokeEventDetail as ClientRevokeEventDetail } from '@/client/core/client-contracts.js'

describe('Gap 13: RevokeEventDetail type compatibility', () => {
  describe('Protocol vs Client RevokeEventDetail shape differences', () => {
    test('protocol version uses nested details object', () => {
      const protocolRevoke: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        details: {
          requested: 'tanstack-query',
          supported: ['swr']
        }
      }
      
      expectTypeOf(protocolRevoke).toMatchTypeOf<ProtocolRevokeEventDetail>()
    })

    test('client version uses top-level requested and supported', () => {
      const clientRevoke: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'tanstack-query',
        supported: ['swr']
      }
      
      expectTypeOf(clientRevoke).toMatchTypeOf<ClientRevokeEventDetail>()
    })

    test('protocol shape should not match client shape', () => {
      const protocolRevoke: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        details: {
          requested: 'tanstack-query',
          supported: ['swr']
        }
      }
      
      // @ts-expect-error - Protocol shape incompatible with client shape
      const asClient: ClientRevokeEventDetail = protocolRevoke
    })

    test('client shape should not match protocol shape', () => {
      const clientRevoke: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'tanstack-query',
        supported: ['swr']
      }
      
      // @ts-expect-error - Client shape incompatible with protocol shape
      const asProtocol: ProtocolRevokeEventDetail = clientRevoke
    })
  })

  describe('unsupported-target reason structure', () => {
    test('protocol version has optional details with optional fields', () => {
      const withDetails: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        details: {
          requested: 'rtk-query',
          supported: ['swr', 'tanstack-query']
        }
      }
      
      const withoutDetails: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target'
      }
      
      const withPartialDetails: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        details: {
          requested: 'rtk-query'
        }
      }
      
      expectTypeOf(withDetails).toMatchTypeOf<ProtocolRevokeEventDetail>()
      expectTypeOf(withoutDetails).toMatchTypeOf<ProtocolRevokeEventDetail>()
      expectTypeOf(withPartialDetails).toMatchTypeOf<ProtocolRevokeEventDetail>()
    })

    test('client version has required requested and supported at top level', () => {
      const valid: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr', 'tanstack-query']
      }
      
      expectTypeOf(valid).toMatchTypeOf<ClientRevokeEventDetail>()
      
      // @ts-expect-error - requested is required
      const missingRequested: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        supported: ['swr']
      }
      
      // @ts-expect-error - supported is required
      const missingSupported: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query'
      }
    })

    test('client version explicitly excludes requested/supported for other reasons', () => {
      const deadlineRevoke: ClientRevokeEventDetail = {
        reason: 'deadline'
      }
      
      expectTypeOf(deadlineRevoke).toMatchTypeOf<ClientRevokeEventDetail>()
      
      // @ts-expect-error - requested not allowed for deadline
      const withRequested: ClientRevokeEventDetail = {
        reason: 'deadline',
        requested: 'swr'
      }
      
      // @ts-expect-error - supported not allowed for deadline
      const withSupported: ClientRevokeEventDetail = {
        reason: 'deadline',
        supported: ['swr']
      }
    })
  })

  describe('Other reason types', () => {
    test('protocol version allows string reasons with optional details', () => {
      const deadline: ProtocolRevokeEventDetail = {
        reason: 'deadline'
      }
      
      const custom: ProtocolRevokeEventDetail = {
        reason: 'session-expired'
      }
      
      const withDetails: ProtocolRevokeEventDetail = {
        reason: 'custom-reason',
        details: { foo: 'bar' }
      }
      
      expectTypeOf(deadline).toMatchTypeOf<ProtocolRevokeEventDetail>()
      expectTypeOf(custom).toMatchTypeOf<ProtocolRevokeEventDetail>()
      expectTypeOf(withDetails).toMatchTypeOf<ProtocolRevokeEventDetail>()
    })

    test('client version allows string reasons with explicit never for requested/supported', () => {
      const deadline: ClientRevokeEventDetail = {
        reason: 'deadline'
      }
      
      const custom: ClientRevokeEventDetail = {
        reason: 'session-expired'
      }
      
      const withUndefinedReason: ClientRevokeEventDetail = {
        reason: undefined
      }
      
      expectTypeOf(deadline).toMatchTypeOf<ClientRevokeEventDetail>()
      expectTypeOf(custom).toMatchTypeOf<ClientRevokeEventDetail>()
      expectTypeOf(withUndefinedReason).toMatchTypeOf<ClientRevokeEventDetail>()
    })
  })

  describe('Type compatibility with event listeners', () => {
    test('protocol shape cannot be used in client event listener', () => {
      // Simulating what a user might try to do
      type EventHandler = (detail: ProtocolRevokeEventDetail) => void
      
      const handler: EventHandler = (detail) => {
        if (detail.reason === 'unsupported-target') {
          // This accesses the nested structure
          const requested = detail.details?.requested
          const supported = detail.details?.supported
        }
      }
      
      // In actual client code, the event detail is ClientRevokeEventDetail
      const actualEventDetail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr']
      }
      
      // @ts-expect-error - Handler expects protocol shape, but gets client shape
      handler(actualEventDetail)
    })

    test('client shape should be used for client event listeners', () => {
      type EventHandler = (detail: ClientRevokeEventDetail) => void
      
      const handler: EventHandler = (detail) => {
        if (detail.reason === 'unsupported-target') {
          // This accesses the top-level fields
          const requested = detail.requested
          const supported = detail.supported
          expectTypeOf(requested).toEqualTypeOf<string>()
          expectTypeOf(supported).toEqualTypeOf<string[]>()
        }
      }
      
      const actualEventDetail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr']
      }
      
      handler(actualEventDetail)
    })
  })

  describe('Type narrowing behavior', () => {
    test('protocol version narrowing', () => {
      const detail: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        details: {
          requested: 'rtk-query',
          supported: ['swr']
        }
      }
      
      if (detail.reason === 'unsupported-target') {
        expectTypeOf(detail.details).toMatchTypeOf<{ requested?: string; supported?: SignalTarget[] } | undefined>()
      }
    })

    test('client version narrowing', () => {
      const detail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr']
      }
      
      if (detail.reason === 'unsupported-target') {
        expectTypeOf(detail.requested).toEqualTypeOf<string>()
        expectTypeOf(detail.supported).toEqualTypeOf<string[]>()
        // @ts-expect-error - details doesn't exist on client version
        const details = detail.details
      }
    })

    test('client version excludes requested/supported for other reasons', () => {
      const detail: ClientRevokeEventDetail = {
        reason: 'deadline'
      }
      
      if (detail.reason === 'deadline') {
        // @ts-expect-error - requested is never for deadline
        const requested = detail.requested
        // @ts-expect-error - supported is never for deadline
        const supported = detail.supported
      }
    })
  })

  describe('Import confusion scenarios', () => {
    test('importing from types/protocol gives wrong shape for client usage', () => {
      // User imports from root
      type RevokDetail = ProtocolRevokeEventDetail
      
      // They write a handler expecting protocol shape
      const handleRevoke = (detail: RevokDetail) => {
        if (detail.reason === 'unsupported-target') {
          // Tries to access nested details
          return detail.details?.requested
        }
      }
      
      // But actual client events use client shape
      const actualDetail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'swr',
        supported: ['tanstack-query']
      }
      
      // @ts-expect-error - Type mismatch
      handleRevoke(actualDetail)
    })

    test('importing from client/core gives correct shape', () => {
      // User imports from client/core
      type RevokDetail = ClientRevokeEventDetail
      
      // They write a handler expecting client shape
      const handleRevoke = (detail: RevokDetail) => {
        if (detail.reason === 'unsupported-target') {
          // Accesses top-level fields
          return detail.requested
        }
      }
      
      // Actual client events match
      const actualDetail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'swr',
        supported: ['tanstack-query']
      }
      
      handleRevoke(actualDetail)
    })
  })

  describe('Documentation and usage patterns', () => {
    test('protocol version supports flexible details', () => {
      const customDetails: ProtocolRevokeEventDetail = {
        reason: 'custom-ban',
        details: {
          bannedUntil: '2024-12-31',
          banReason: 'spam'
        }
      }
      
      expectTypeOf(customDetails.details).toEqualTypeOf<unknown>()
    })

    test('client version uses discriminated union', () => {
      const detail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr']
      }
      
      // TypeScript should narrow correctly
      if (detail.reason === 'unsupported-target') {
        expectTypeOf(detail).toMatchTypeOf<{
          reason: 'unsupported-target'
          requested: string
          supported: string[]
        }>()
      } else {
        expectTypeOf(detail).toMatchTypeOf<{
          reason: 'deadline' | (string & {}) | undefined
          requested?: never
          supported?: never
        }>()
      }
    })
  })

  describe('Type equality and assignability', () => {
    test('two types should not be equal', () => {
      expectTypeOf<ProtocolRevokeEventDetail>().not.toEqualTypeOf<ClientRevokeEventDetail>()
      expectTypeOf<ClientRevokeEventDetail>().not.toEqualTypeOf<ProtocolRevokeEventDetail>()
    })

    test('protocol type should not be assignable to client type', () => {
      type IsAssignable<T, U> = T extends U ? true : false
      
      expectTypeOf<IsAssignable<ProtocolRevokeEventDetail, ClientRevokeEventDetail>>().toEqualTypeOf<false>()
    })

    test('client type should not be assignable to protocol type', () => {
      type IsAssignable<T, U> = T extends U ? true : false
      
      expectTypeOf<IsAssignable<ClientRevokeEventDetail, ProtocolRevokeEventDetail>>().toEqualTypeOf<false>()
    })
  })

  describe('Recommended canonical shape', () => {
    test('client shape is the actual runtime shape', () => {
      // This documents that the client shape is what's actually emitted
      const runtimeShape: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr', 'tanstack-query']
      }
      
      expectTypeOf(runtimeShape).toMatchTypeOf<ClientRevokeEventDetail>()
    })

    test('protocol shape is documentation/internal use only', () => {
      // Protocol shape should be marked as internal or deprecated
      // or renamed to avoid confusion
      const internalShape: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        details: {
          requested: 'rtk-query',
          supported: ['swr']
        }
      }
      
      expectTypeOf(internalShape).toMatchTypeOf<ProtocolRevokeEventDetail>()
    })
  })

  describe('Edge cases with undefined reason', () => {
    test('client version allows undefined reason', () => {
      const undefinedReason: ClientRevokeEventDetail = {
        reason: undefined
      }
      
      expectTypeOf(undefinedReason).toMatchTypeOf<ClientRevokeEventDetail>()
    })

    test('protocol version allows undefined in string union', () => {
      // Protocol version uses `{ reason: string; details?: unknown }`
      // which includes any string, but doesn't explicitly show undefined
      const stringReason: ProtocolRevokeEventDetail = {
        reason: 'any-string'
      }
      
      expectTypeOf(stringReason).toMatchTypeOf<ProtocolRevokeEventDetail>()
    })
  })

  describe('Type guard patterns', () => {
    test('client version supports type guard for unsupported-target', () => {
      function isUnsupportedTarget(
        detail: ClientRevokeEventDetail
      ): detail is Extract<ClientRevokeEventDetail, { reason: 'unsupported-target' }> {
        return detail.reason === 'unsupported-target'
      }
      
      const detail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr']
      }
      
      if (isUnsupportedTarget(detail)) {
        expectTypeOf(detail.requested).toEqualTypeOf<string>()
        expectTypeOf(detail.supported).toEqualTypeOf<string[]>()
      }
    })

    test('protocol version type guard accesses nested details', () => {
      function isUnsupportedTarget(
        detail: ProtocolRevokeEventDetail
      ): detail is Extract<ProtocolRevokeEventDetail, { reason: 'unsupported-target' }> {
        return detail.reason === 'unsupported-target'
      }
      
      const detail: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        details: { requested: 'rtk-query', supported: ['swr'] }
      }
      
      if (isUnsupportedTarget(detail)) {
        expectTypeOf(detail.details).toBeDefined()
      }
    })
  })
})
