/**
 * Gap 13: RevokeEventDetail type compatibility
 * 
 * Originally documented a conflict where `ProtocolRevokeEventDetail` used a nested `details` object
 * while `ClientRevokeEventDetail` used flat top-level `requested` and `supported` fields.
 * 
 * Resolution: Both exports now use the unified flat shape with top-level `requested` and `supported`.
 * The legacy nested `details` property has been removed across all exports.
 */

import { describe, expectTypeOf, test } from 'vitest'
import { RevokeEventDetail as ProtocolRevokeEventDetail } from '@/types/protocol.js'
import { RevokeEventDetail as ClientRevokeEventDetail } from '@/client/core/client-contracts.js'

describe('Gap 13: RevokeEventDetail type compatibility', () => {
  describe('Protocol vs Client RevokeEventDetail shape compatibility', () => {
    test('protocol version uses top-level requested and supported', () => {
      const protocolRevoke: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'tanstack-query',
        supported: ['swr']
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

    test('protocol shape and client shape are bidirectionally assignable', () => {
      const revoke: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'tanstack-query',
        supported: ['swr']
      }
      
      const asClient: ClientRevokeEventDetail = revoke
      const asProtocol: ProtocolRevokeEventDetail = asClient

      expectTypeOf(asClient).toMatchTypeOf<ProtocolRevokeEventDetail>()
      expectTypeOf(asProtocol).toMatchTypeOf<ClientRevokeEventDetail>()
    })

    test('legacy nested details property is rejected on both protocol and client shapes', () => {
      const asProtocol: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        // @ts-expect-error - details property does not exist on ProtocolRevokeEventDetail
        details: { requested: 'tanstack-query', supported: ['swr'] }
      }

      const asClient: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        // @ts-expect-error - details property does not exist on ClientRevokeEventDetail
        details: { requested: 'tanstack-query', supported: ['swr'] }
      }
    })
  })

  describe('unsupported-target reason structure', () => {
    test('requires requested and supported at top level', () => {
      const valid: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr', 'tanstack-query']
      }
      
      expectTypeOf(valid).toMatchTypeOf<ClientRevokeEventDetail>()
      
      // @ts-expect-error - requested is required for unsupported-target
      const missingRequested: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        supported: ['swr']
      }
      
      // @ts-expect-error - supported is required for unsupported-target
      const missingSupported: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query'
      }
    })

    test('explicitly excludes requested/supported for other reasons', () => {
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
    test('allows standard string reasons with explicit never for requested/supported', () => {
      const deadline: ClientRevokeEventDetail = { reason: 'deadline' }
      const custom: ClientRevokeEventDetail = { reason: 'session-expired' }
      const withUndefinedReason: ClientRevokeEventDetail = { reason: undefined }
      
      expectTypeOf(deadline).toMatchTypeOf<ClientRevokeEventDetail>()
      expectTypeOf(custom).toMatchTypeOf<ClientRevokeEventDetail>()
      expectTypeOf(withUndefinedReason).toMatchTypeOf<ClientRevokeEventDetail>()
    })
  })

  describe('Type compatibility with event listeners', () => {
    test('protocol handler accepts client event detail', () => {
      type EventHandler = (detail: ProtocolRevokeEventDetail) => void
      
      const handler: EventHandler = (detail) => {
        if (detail.reason === 'unsupported-target') {
          const requested = detail.requested
          const supported = detail.supported
          expectTypeOf(requested).toMatchTypeOf<string | undefined>()
          expectTypeOf(supported).toMatchTypeOf<string[] | undefined>()
        }
      }
      
      const actualEventDetail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr']
      }
      
      handler(actualEventDetail)
    })

    test('client handler accepts protocol event detail', () => {
      type EventHandler = (detail: ClientRevokeEventDetail) => void
      
      const handler: EventHandler = (detail) => {
        if (detail.reason === 'unsupported-target') {
          const requested = detail.requested
          const supported = detail.supported
          expectTypeOf(requested).toMatchTypeOf<string | undefined>()
          expectTypeOf(supported).toMatchTypeOf<string[] | undefined>()
        }
      }
      
      const protocolDetail: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr']
      }
      
      handler(protocolDetail)
    })
  })

  describe('Type narrowing behavior', () => {
    test('narrows top-level requested and supported when reason is unsupported-target', () => {
      const detail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr']
      }
      
      if (detail.reason === 'unsupported-target') {
        expectTypeOf(detail.requested).toEqualTypeOf<string>()
        expectTypeOf(detail.supported).toEqualTypeOf<string[]>()
        // @ts-expect-error - details property does not exist on narrowed shape
        const details = detail.details
      }
    })

    test('excludes requested/supported for deadline reason', () => {
      const detail: ClientRevokeEventDetail = {
        reason: 'deadline'
      }
      
      if (detail.reason === 'deadline') {
        expectTypeOf(detail.requested).toEqualTypeOf<undefined>()
        expectTypeOf(detail.supported).toEqualTypeOf<undefined>()
      }
    })
  })

  describe('Import scenarios', () => {
    test('importing from types/protocol gives unified shape compatible with client usage', () => {
      type RevokDetail = ProtocolRevokeEventDetail
      
      const handleRevoke = (detail: RevokDetail) => {
        if (detail.reason === 'unsupported-target') {
          return detail.requested
        }
      }
      
      const actualDetail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'swr',
        supported: ['tanstack-query']
      }
      
      handleRevoke(actualDetail)
    })

    test('importing from client/core gives correct shape', () => {
      type RevokDetail = ClientRevokeEventDetail
      
      const handleRevoke = (detail: RevokDetail) => {
        if (detail.reason === 'unsupported-target') {
          return detail.requested
        }
      }
      
      const actualDetail: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'swr',
        supported: ['tanstack-query']
      }
      
      handleRevoke(actualDetail)
    })
  })

  describe('Documentation and usage patterns', () => {
    test('discriminated union narrows correctly for unsupported-target vs other reasons', () => {
      const assertNarrowing = (detail: ClientRevokeEventDetail) => {
        if (detail.reason === 'unsupported-target') {
          expectTypeOf(detail).toEqualTypeOf<
            Extract<ClientRevokeEventDetail, { reason: 'unsupported-target' }>
          >()
        } else {
          expectTypeOf(detail.reason).not.toEqualTypeOf<never>()
        }
      }

      assertNarrowing({ reason: 'unsupported-target', requested: 'rtk-query', supported: ['swr'] })
    })
  })

  describe('Type equality and assignability', () => {
    test('two exported types are identical', () => {
      expectTypeOf<ProtocolRevokeEventDetail>().toMatchTypeOf<ClientRevokeEventDetail>()
      expectTypeOf<ClientRevokeEventDetail>().toMatchTypeOf<ProtocolRevokeEventDetail>()
    })

    test('protocol type is assignable to client type', () => {
      type IsAssignable<T, U> = T extends U ? true : false
      expectTypeOf<IsAssignable<ProtocolRevokeEventDetail, ClientRevokeEventDetail>>().toEqualTypeOf<true>()
    })

    test('client type is assignable to protocol type', () => {
      type IsAssignable<T, U> = T extends U ? true : false
      expectTypeOf<IsAssignable<ClientRevokeEventDetail, ProtocolRevokeEventDetail>>().toEqualTypeOf<true>()
    })
  })

  describe('Recommended canonical shape', () => {
    test('both exports match actual runtime shape', () => {
      const runtimeShape: ClientRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr', 'tanstack-query']
      }
      
      const protocolShape: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr', 'tanstack-query']
      }

      expectTypeOf(runtimeShape).toMatchTypeOf<ProtocolRevokeEventDetail>()
      expectTypeOf(protocolShape).toMatchTypeOf<ClientRevokeEventDetail>()
    })
  })

  describe('Edge cases with undefined reason', () => {
    test('allows undefined reason', () => {
      const undefinedReason: ClientRevokeEventDetail = {
        reason: undefined
      }
      
      expectTypeOf(undefinedReason).toMatchTypeOf<ClientRevokeEventDetail>()
    })

    test('allows string union reasons', () => {
      const stringReason: ProtocolRevokeEventDetail = {
        reason: 'any-string'
      }
      
      expectTypeOf(stringReason).toMatchTypeOf<ProtocolRevokeEventDetail>()
    })
  })

  describe('Type guard patterns', () => {
    test('supports type guard for unsupported-target', () => {
      function isUnsupportedTarget(
        detail: ClientRevokeEventDetail | ProtocolRevokeEventDetail
      ): detail is Extract<ClientRevokeEventDetail, { reason: 'unsupported-target' }> {
        return detail.reason === 'unsupported-target'
      }
      
      const detail: ProtocolRevokeEventDetail = {
        reason: 'unsupported-target',
        requested: 'rtk-query',
        supported: ['swr']
      }
      
      if (isUnsupportedTarget(detail)) {
        expectTypeOf(detail.requested).toEqualTypeOf<string>()
        expectTypeOf(detail.supported).toEqualTypeOf<string[]>()
      }
    })
  })
})
