import { describe, expectTypeOf, test } from 'vitest'
import type { PubSubAdapter, PubSubEncryptionOptions } from '@/pubsub/core/index.js'
import { PubSubDecryptionError } from '@/pubsub/core/index.js'
import type { SWRSignal, PubSubMessage } from '@/types/index.js'

describe('PubSubEncryptionOptions mutual exclusivity', () => {
  test('valid encryption options compile', () => {
    const disabled: PubSubEncryptionOptions = { encrypt: false }
    const enabled: PubSubEncryptionOptions = { encrypt: true, encryptionKey: '32-byte-secret-key-base64-or-hex' }

    expectTypeOf(disabled).toMatchTypeOf<PubSubEncryptionOptions>()
    expectTypeOf(enabled).toMatchTypeOf<PubSubEncryptionOptions>()
  })

  test('invalid combinations cause compile errors', () => {
    // @ts-expect-error encrypt: false cannot be combined with an encryptionKey
    const _invalid1: PubSubEncryptionOptions = { encrypt: false, encryptionKey: 'some-key' }

    // @ts-expect-error encrypt: true requires an encryptionKey
    const _invalid2: PubSubEncryptionOptions = { encrypt: true }
  })
})

describe('PubSubAdapter interface typing', () => {
  test('PubSubAdapter publish and subscribe parameter types', () => {
    type Adapter = PubSubAdapter<SWRSignal>
    const adapter = {} as Adapter

    expectTypeOf(adapter.publish).toBeCallableWith('topic-name', {
      kind: 'signal',
      data: { target: 'swr', key: ['todos'] },
    })

    expectTypeOf(adapter.subscribe).toBeCallableWith('topic-name', (msg: PubSubMessage<SWRSignal>) => {
      if (msg.kind === 'signal') {
        expectTypeOf(msg.data).toEqualTypeOf<SWRSignal | SWRSignal[]>()
      }
    })
  })

  test('PubSubDecryptionError class', () => {
    const err = new PubSubDecryptionError('decryption failed')
    expectTypeOf(err).toEqualTypeOf<PubSubDecryptionError>()
    expectTypeOf(err.message).toEqualTypeOf<string>()
  })
})
