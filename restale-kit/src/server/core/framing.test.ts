import { describe, it, expect } from 'vitest'
import { formatInvalidateFrame, formatKeepalive, formatRevokeFrame, formatRetryFrame } from './framing.js'

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

  it('formats retry frame', () => {
    const bytes = formatRetryFrame(5000)
    const str = decoder.decode(bytes)

    expect(str).toBe('retry: 5000\n\n')
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

  it('sanitizes control characters in reason via JSON.stringify', () => {
    const bytes = formatRevokeFrame('bad\r\nreason\n')
    const str = decoder.decode(bytes)

    // JSON.stringify encodes \r as \r and \n as \n — produces valid JSON
    // The client parses this correctly; the SSE frame itself is a single data: line
    expect(str).toBe('event: revoke\ndata: {"reason":"bad\\r\\nreason\\n"}\n\n')

    // Verify the client can parse it back
    const dataLine = str.split('\n').find((l) => l.startsWith('data:'))!
    const parsed: unknown = JSON.parse(dataLine.slice('data: '.length))
    expect(parsed).toEqual({ reason: 'bad\r\nreason\n' })
  })

  it('escapes quotes and backslashes in reason via JSON.stringify', () => {
    const bytes = formatRevokeFrame('reason with "quotes" and \\backslash')
    const str = decoder.decode(bytes)

    expect(str).toBe('event: revoke\ndata: {"reason":"reason with \\"quotes\\" and \\\\backslash"}\n\n')
  })
})
