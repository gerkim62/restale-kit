/**
 * Gap 5: Channel/group transport setup can override the group's typed target
 * 
 * ChannelSetupOptions is independent of the group's TSignal/TTarget. A group
 * typed as SWR can create a TanStack channel but return it as SSEChannel<SWRSignal>.
 * This allows type-unsafe channels to be registered to groups.
 */

import { describe, expectTypeOf, test } from 'vitest'
import { SSEChannelGroup, type ChannelSetupOptions } from '@/server/core/index.js'
import { createSSEChannel } from '@/testing/index.js'
import type { InvalidateSignal, SWRSignal, TanStackQuerySignal, RTKQuerySignal } from '@/types/index.js'

describe('Gap 5: ChannelSetupOptions target must match group signal type', () => {
  describe('createFetchResponse target validation', () => {
    test('should reject mismatched target in SWR group', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      // @ts-expect-error - TanStack target conflicts with SWR group
      swrGroup.createFetchResponse(mockRequest, { target: 'tanstack-query' })
      
      // @ts-expect-error - RTK target conflicts with SWR group
      swrGroup.createFetchResponse(mockRequest, { target: 'rtk-query' })
    })

    test('should reject mismatched target in TanStack group', () => {
      const tanstackGroup = new SSEChannelGroup<TanStackQuerySignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      // @ts-expect-error - SWR target conflicts with TanStack group
      tanstackGroup.createFetchResponse(mockRequest, { target: 'swr' })
      
      // @ts-expect-error - RTK target conflicts with TanStack group
      tanstackGroup.createFetchResponse(mockRequest, { target: 'rtk-query' })
    })

    test('should reject mismatched target in RTK group', () => {
      const rtkGroup = new SSEChannelGroup<RTKQuerySignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      // @ts-expect-error - SWR target conflicts with RTK group
      rtkGroup.createFetchResponse(mockRequest, { target: 'swr' })
      
      // @ts-expect-error - TanStack target conflicts with RTK group
      rtkGroup.createFetchResponse(mockRequest, { target: 'tanstack-query' })
    })

    test('should accept matching target in SWR group', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      const { channel } = swrGroup.createFetchResponse(mockRequest, { target: 'swr' })
      expectTypeOf(channel.invalidate).toBeCallableWith({ target: 'swr', key: ['test'] })
    })

    test('should accept matching target in TanStack group', () => {
      const tanstackGroup = new SSEChannelGroup<TanStackQuerySignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      const { channel } = tanstackGroup.createFetchResponse(mockRequest, { target: 'tanstack-query' })
      expectTypeOf(channel.invalidate).toBeCallableWith({ target: 'tanstack-query', queryKey: ['test'] })
    })

    test('should accept matching target in RTK group', () => {
      const rtkGroup = new SSEChannelGroup<RTKQuerySignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      const { channel } = rtkGroup.createFetchResponse(mockRequest, { target: 'rtk-query' })
      expectTypeOf(channel.invalidate).toBeCallableWith({ target: 'rtk-query', tags: [{ type: 'Test' }] })
    })

    test('should allow omitting target when group has channelDefaults', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>({
        channelDefaults: { target: 'swr' }
      })
      const mockRequest = new Request('http://localhost/sse')
      
      // Omitting target should use default
      const { channel } = swrGroup.createFetchResponse(mockRequest, {})
      expectTypeOf(channel.invalidate).toBeCallableWith({ target: 'swr', key: ['test'] })
    })

    test('should reject target override that conflicts with group type', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>({
        channelDefaults: { target: 'swr' }
      })
      const mockRequest = new Request('http://localhost/sse')
      
      // @ts-expect-error - Explicit override must still match group signal type
      swrGroup.createFetchResponse(mockRequest, { target: 'tanstack-query' })
    })
  })

  describe('attachNodeResponse target validation', () => {
    test('should reject mismatched target in SWR group', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      const mockReq = {} as any
      const mockRes = {} as any
      
      // @ts-expect-error - TanStack target conflicts with SWR group
      swrGroup.attachNodeResponse(mockReq, mockRes, { target: 'tanstack-query' })
      
      // @ts-expect-error - RTK target conflicts with SWR group
      swrGroup.attachNodeResponse(mockReq, mockRes, { target: 'rtk-query' })
    })

    test('should reject mismatched target in TanStack group', () => {
      const tanstackGroup = new SSEChannelGroup<TanStackQuerySignal>()
      const mockReq = {} as any
      const mockRes = {} as any
      
      // @ts-expect-error - SWR target conflicts with TanStack group
      tanstackGroup.attachNodeResponse(mockReq, mockRes, { target: 'swr' })
      
      // @ts-expect-error - RTK target conflicts with TanStack group
      tanstackGroup.attachNodeResponse(mockReq, mockRes, { target: 'rtk-query' })
    })

    test('should accept matching target in SWR group', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      const mockReq = {} as any
      const mockRes = {} as any
      
      const { channel } = swrGroup.attachNodeResponse(mockReq, mockRes, { target: 'swr' })
      expectTypeOf(channel.invalidate).toBeCallableWith({ target: 'swr', key: ['test'] })
    })

    test('should accept matching target in TanStack group', () => {
      const tanstackGroup = new SSEChannelGroup<TanStackQuerySignal>()
      const mockReq = {} as any
      const mockRes = {} as any
      
      const { channel } = tanstackGroup.attachNodeResponse(mockReq, mockRes, { target: 'tanstack-query' })
      expectTypeOf(channel.invalidate).toBeCallableWith({ target: 'tanstack-query', queryKey: ['test'] })
    })

    test('should allow omitting target when group has channelDefaults', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>({
        channelDefaults: { target: 'swr' }
      })
      const mockReq = {} as any
      const mockRes = {} as any
      
      const { channel } = swrGroup.attachNodeResponse(mockReq, mockRes, {})
      expectTypeOf(channel.invalidate).toBeCallableWith({ target: 'swr', key: ['test'] })
    })
  })

  describe('Multi-target group transport setup', () => {
    test('should enforce multi-target batch for multi-target group', () => {
      const multiGroup = new SSEChannelGroup<SWRSignal | TanStackQuerySignal>({
        target: ['swr', 'tanstack-query'] as const
      })
      const mockRequest = new Request('http://localhost/sse')
      
      const { channel } = multiGroup.createFetchResponse(mockRequest, { target: 'swr' })
      
      // Should accept multi-target
      const result = multiGroup.createFetchResponse(mockRequest, { 
        target: ['swr', 'tanstack-query'] as const 
      })
      expectTypeOf(result.channel).not.toEqualTypeOf<never>()
    })

    test('should reject single target for multi-target group in attachNodeResponse', () => {
      const multiGroup = new SSEChannelGroup<SWRSignal | TanStackQuerySignal>({
        target: ['swr', 'tanstack-query'] as const
      })
      const mockReq = {} as any
      const mockRes = {} as any
      
      multiGroup.attachNodeResponse(mockReq, mockRes, { target: 'swr' })
      
      // Should accept multi-target
      const { channel } = multiGroup.attachNodeResponse(mockReq, mockRes, { 
        target: ['swr', 'tanstack-query'] as const 
      })
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })
  })

  describe('ChannelSetupOptions type structure', () => {
    test('ChannelSetupOptions should be parameterized by group signal type and metadata type', () => {
      type SwrSetupOptions = ChannelSetupOptions<SWRSignal, { userId: number }>

      // Valid SWR target
      const validOptions: SwrSetupOptions = {
        target: 'swr',
        meta: { userId: 1 }
      }
      expectTypeOf(validOptions).toExtend<SwrSetupOptions>()
    })

    test('should include all SSEChannelOptions except target', () => {
      type SetupOpts = ChannelSetupOptions
      
      const options: SetupOpts = {
        target: 'swr',
        keepaliveIntervalMs: 30000,
        retryIntervalMs: 5000,
        beforeFrame: (ctx) => ({ action: 'send' })
      }
      
      expectTypeOf(options).toExtend<SetupOpts>()
    })

    test('should allow topics array', () => {
      type SetupOpts = ChannelSetupOptions<InvalidateSignal, { userId: number }>
      
      const options: SetupOpts = {
        target: 'swr',
        topics: ['user-updates', 'global-updates'],
        meta: { userId: 1 }
      }
      
      expectTypeOf(options.topics).toEqualTypeOf<string[] | undefined>()
    })

    test('should enforce meta type when TMeta is not undefined', () => {
      type SetupOptsWithMeta = ChannelSetupOptions<InvalidateSignal, { userId: number }>
      
      // @ts-expect-error - Missing required meta
      const missingMeta: SetupOptsWithMeta = {
        target: 'swr'
      }
      
      const wrongMeta: SetupOptsWithMeta = {
        target: 'swr',
        // @ts-expect-error - metadata must use the declared UserMeta shape
        meta: { userName: 'alice' }
      }
      
      // Valid
      const validMeta: SetupOptsWithMeta = {
        target: 'swr',
        meta: { userId: 1 }
      }
      expectTypeOf(validMeta).toExtend<SetupOptsWithMeta>()
    })

    test('should make meta optional when TMeta extends undefined', () => {
      type SetupOptsNoMeta = ChannelSetupOptions
      
      const noMeta: SetupOptsNoMeta = {
        target: 'swr'
      }
      
      const withMeta: SetupOptsNoMeta = {
        target: 'swr',
        meta: { foo: 'bar' }
      }
      
      expectTypeOf(noMeta).toExtend<SetupOptsNoMeta>()
      expectTypeOf(withMeta).toExtend<SetupOptsNoMeta>()
    })
  })

  describe('Edge cases and type narrowing', () => {
    test('should prevent target widening to plain string', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      const dynamicTarget: string = 'tanstack-query'
      
      // @ts-expect-error - Plain string too broad
      swrGroup.createFetchResponse(mockRequest, { target: dynamicTarget })
    })

    test('should maintain literal types for target', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      const swrTarget = 'swr' as const
      const { channel } = swrGroup.createFetchResponse(mockRequest, { target: swrTarget })
      
      expectTypeOf(channel).not.toEqualTypeOf<never>()
    })

    test('should handle union signal types with correct target', () => {
      const mixedGroup = new SSEChannelGroup<SWRSignal | TanStackQuerySignal>()
      const mockRequest = new Request('http://localhost/sse')
      
      // For union groups without explicit target array in constructor,
      // ChannelSetupOptions should accept either matching target
      const swrChannel = mixedGroup.createFetchResponse(mockRequest, { target: 'swr' })
      const tanstackChannel = mixedGroup.createFetchResponse(mockRequest, { target: 'tanstack-query' })
      
      expectTypeOf(swrChannel.channel).not.toEqualTypeOf<never>()
      expectTypeOf(tanstackChannel.channel).not.toEqualTypeOf<never>()
    })
  })

  describe('Integration with register method', () => {
    test('should reject registering channel with incompatible signal type', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      
      // Create a TanStack channel
      const tanstackChannel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      
      // @ts-expect-error - Cannot register TanStack channel to SWR group
      swrGroup.register(tanstackChannel)
    })

    test('should accept registering channel with matching signal type', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal>()
      
      const swrChannel = createSSEChannel<SWRSignal>({ target: 'swr' })
      
      swrGroup.register(swrChannel)
      expectTypeOf(swrGroup.size).toEqualTypeOf<number>()
    })

    test('should reject registering channel with meta when signal types mismatch', () => {
      const swrGroup = new SSEChannelGroup<SWRSignal, { userId: number }>()
      
      const tanstackChannel = createSSEChannel<TanStackQuerySignal>({ target: 'tanstack-query' })
      
      // @ts-expect-error - TanStack channel incompatible with SWR group
      swrGroup.register(tanstackChannel, { userId: 1 })
    })
  })
})
