import { describe, expect, it, vi } from 'vitest'
import { tanstackQueryAdapter, type QueryClientLike } from './client/tanstack-query/adapter.js'
import { swrAdapter, type SWRMutator } from './client/swr/adapter.js'
import { validatePayload } from './client/core/validation.js'
import { createSSEChannel } from './server/core/channel.js'
import { SSEChannelGroup } from './server/core/channel-group.js'
import { SSEInvalidatorClient } from './client/core/sse-client.js'

describe('universal signal protocol', () => {
  it('serialises universal signals without targets and validates both arms', async () => {
    const channel = createSSEChannel()
    const reader = channel.stream.getReader()
    channel.invalidate([{ key: ['todos'] }, { key: ['todos', 1], inlineData: { id: 1 } }])
    const frame = new TextDecoder().decode((await reader.read()).value)
    expect(frame).toContain('event: invalidate')
    expect(frame).toContain('"key":["todos"]')
    expect(frame).not.toContain('target')
    expect(validatePayload('{"key":["todos"],"inlineData":{"id":1}}')).toEqual({ key: ['todos'], inlineData: { id: 1 } })
    expect(() => validatePayload('{"key":["todos"],"target":"swr"}')).toThrow('unsupported fields')
    expect(() => validatePayload('{"key":["todos"],"inlineData":1,"exact":true}')).toThrow('unsupported fields')
  })

  it('broadcasts the same universal signal to every registered channel', async () => {
    const group = new SSEChannelGroup()
    const first = createSSEChannel()
    const second = createSSEChannel()
    const firstReader = first.stream.getReader()
    const secondReader = second.stream.getReader()
    group.register(first)
    group.register(second)
    group.broadcastToAll({ key: ['todos'] })
    const decoder = new TextDecoder()
    expect(decoder.decode((await firstReader.read()).value)).toContain('"key":["todos"]')
    expect(decoder.decode((await secondReader.read()).value)).toContain('"key":["todos"]')
  })

  it('adds only the connection identity parameter to the client URL', () => {
    const client = new SSEInvalidatorClient('https://example.test/events')
    const eventSourceUrl = Reflect.get(client, 'eventSourceUrl') as string
    expect(eventSourceUrl).toContain('__restale_cid__=')
  })
})

describe('universal adapters', () => {
  it('honours exact and only revalidates inline data when markStale is true', () => {
    const queryClient: QueryClientLike = {
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    }
    const adapter = tanstackQueryAdapter(queryClient, { toQueryKey: (key) => ['native', ...key] })
    adapter([{ key: ['posts'], exact: false }, { key: ['posts', 1], inlineData: { id: 1 } },
      { key: ['posts', 2], inlineData: { id: 2 }, markStale: true }])
    expect(queryClient.setQueryData).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ['native', 'posts'], exact: false })
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ['native', 'posts', 2], exact: true })
  })

  it('uses an exact key for SWR inline-data follow-up revalidation', () => {
    const mutate = vi.fn().mockResolvedValue(undefined) as unknown as SWRMutator
    swrAdapter(mutate, { toKey: (key) => key[0] as string })({ key: ['posts', 1], inlineData: { id: 1 }, markStale: true })
    expect(mutate).toHaveBeenNthCalledWith(1, 'posts', { id: 1 }, { revalidate: false })
    expect(mutate).toHaveBeenNthCalledWith(2, 'posts')
  })
})
