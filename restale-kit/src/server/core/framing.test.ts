import { describe, it, expect } from 'vitest'
import { formatInvalidateFrame, formatKeepalive } from './framing.js'

const decoder = new TextDecoder()

describe('framing', () => {
  it('formats invalidate frame without id', () => {
    const signal = { key: ['todos'] }
    const bytes = formatInvalidateFrame(signal)
    const str = decoder.decode(bytes)

    expect(str).toBe('event: invalidate\ndata: {"key":["todos"]}\n\n')
  })

  it('formats invalidate frame with string id', () => {
    const signal = { key: ['users', 1] }
    const bytes = formatInvalidateFrame(signal, 'evt-42')
    const str = decoder.decode(bytes)

    expect(str).toBe('id: evt-42\nevent: invalidate\ndata: {"key":["users",1]}\n\n')
  })

  it('formats invalidate frame with numeric id', () => {
    const signal = { key: ['users', 1] }
    const bytes = formatInvalidateFrame(signal, 100)
    const str = decoder.decode(bytes)

    expect(str).toBe('id: 100\nevent: invalidate\ndata: {"key":["users",1]}\n\n')
  })

  it('sanitizes CR/LF characters from id', () => {
    const signal = { key: ['test'] }
    const bytes = formatInvalidateFrame(signal, 'id\r\nwith\nnewlines')
    const str = decoder.decode(bytes)

    expect(str).toBe('id: idwithnewlines\nevent: invalidate\ndata: {"key":["test"]}\n\n')
  })

  it('formats keepalive frame', () => {
    const bytes = formatKeepalive()
    const str = decoder.decode(bytes)

    expect(str).toBe(': keepalive\n\n')
  })
})
