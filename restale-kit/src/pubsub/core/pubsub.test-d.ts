import { expectTypeOf, test } from 'vitest'
import type { JSONValue, Signal } from '@/types/index.js'
import type { PubSubAdapter, PubSubMessage } from '@/pubsub/core/index.js'

test('PubSubMessage discriminated union type contracts', () => {
  const signalMsg: PubSubMessage = {
    kind: 'signal',
    data: { key: ['users'] },
    id: 'msg-1',
  }
  const controlMsg: PubSubMessage = {
    kind: 'control',
    data: { type: 'revokeWhere', filter: { orgId: 'org-1' } },
  }
  const inlineDataMsg: PubSubMessage = {
    kind: 'inlineData',
    topic: 'chat',
    payload: { text: 'hello' },
  }

  expectTypeOf(signalMsg).toMatchTypeOf<PubSubMessage>()
  expectTypeOf(controlMsg).toMatchTypeOf<PubSubMessage>()
  expectTypeOf(inlineDataMsg).toMatchTypeOf<PubSubMessage>()

  // Discriminated narrowing
  if (signalMsg.kind === 'signal') {
    expectTypeOf(signalMsg.data).toEqualTypeOf<Signal | Signal[]>()
    expectTypeOf(signalMsg.id).toEqualTypeOf<string | undefined>()
  } else if (controlMsg.kind === 'control') {
    expectTypeOf(controlMsg.data).toEqualTypeOf<JSONValue>()
  } else if (inlineDataMsg.kind === 'inlineData') {
    expectTypeOf(inlineDataMsg.topic).toEqualTypeOf<string>()
    expectTypeOf(inlineDataMsg.payload).toEqualTypeOf<JSONValue>()
  }
})

test('PubSubAdapter interface contracts', () => {
  const adapter: PubSubAdapter = {
    publish: async (topic: string, message: PubSubMessage) => {
      expectTypeOf(topic).toEqualTypeOf<string>()
      expectTypeOf(message).toMatchTypeOf<PubSubMessage>()
    },
    subscribe: async (topic: string, callback: (msg: PubSubMessage) => void) => {
      expectTypeOf(topic).toEqualTypeOf<string>()
      expectTypeOf(callback).toEqualTypeOf<(msg: PubSubMessage) => void>()
      return () => {}
    },
  }

  expectTypeOf(adapter).toMatchTypeOf<PubSubAdapter>()
})
