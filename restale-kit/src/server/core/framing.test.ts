import { describe, it, expect } from 'vitest'
import { formatInvalidateFrame, formatKeepalive, formatRevokeFrame } from './framing.js'

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

describe('formatRevokeFrame', () => {
  it('formats revoke frame with default reason', () => {
    const bytes = formatRevokeFrame('revoked')
    const str = decoder.decode(bytes)

    expect(str).toBe('event: revoke\ndata: {"reason":"revoked"}\n\n')
  })

  it('formats revoke frame with custom reason', () => {
    const bytes = formatRevokeFrame('logout')
    const str = decoder.decode(bytes)

    expect(str).toBe('event: revoke\ndata: {"reason":"logout"}\n\n')
  })

  it('sanitizes CR/LF characters from reason', () => {
    const bytes = formatRevokeFrame('bad\r\nreason\n')
    const str = decoder.decode(bytes)

    // CR/LF stripped — would otherwise break SSE framing
    expect(str).toBe('event: revoke\ndata: {"reason":"badreason"}\n\n')
  })

  it('escapes quotes and backslashes in reason', () => {
    const bytes = formatRevokeFrame('reason with "quotes" and \\backslash')
    const str = decoder.decode(bytes)

    expect(str).toBe('event: revoke\ndata: {"reason":"reason with \\"quotes\\" and \\\\backslash"}\n\n')
  })
})
