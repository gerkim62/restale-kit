import { describe, it, expect } from 'vitest'
import { formatInvalidateFrame, formatKeepalive, formatRevokeFrame, formatRetryFrame, formatRenewFrame } from './framing.js'

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

  it('throws error for non-finite retryMs in formatRetryFrame', () => {
    expect(() => formatRetryFrame(NaN)).toThrow('[formatRetryFrame] retryMs must be a finite number.')
    expect(() => formatRetryFrame(Infinity)).toThrow('[formatRetryFrame] retryMs must be a finite number.')
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

  it('formats revoke frame with unsupported-target reason and structured details', () => {
    const bytes = formatRevokeFrame('unsupported-target', {
      requested: 'rtk-query',
      supported: ['tanstack-query', 'swr'],
    })
    const str = decoder.decode(bytes)

    expect(str).toBe(
      'event: revoke\ndata: {"reason":"unsupported-target","requested":"rtk-query","supported":["tanstack-query","swr"]}\n\n'
    )
  })

  it('formats revoke frame with structured details: client can parse the data back', () => {
    const bytes = formatRevokeFrame('unsupported-target', {
      requested: 'rtk-query',
      supported: ['swr'],
    })
    const str = decoder.decode(bytes)
    const dataLine = str.split('\n').find((l) => l.startsWith('data:'))!
    const parsed: unknown = JSON.parse(dataLine.slice('data: '.length))

    expect(parsed).toEqual({
      reason: 'unsupported-target',
      requested: 'rtk-query',
      supported: ['swr'],
    })
  })

  it('formats revoke frame with empty supported array', () => {
    const bytes = formatRevokeFrame('unsupported-target', {
      requested: 'rtk-query',
      supported: [],
    })
    const str = decoder.decode(bytes)

    expect(str).toBe(
      'event: revoke\ndata: {"reason":"unsupported-target","requested":"rtk-query","supported":[]}\n\n'
    )
  })

  it('omits requested/supported fields when details not provided', () => {
    const bytes = formatRevokeFrame('session-expired')
    const str = decoder.decode(bytes)
    const dataLine = str.split('\n').find((l) => l.startsWith('data:'))!
    const parsed: unknown = JSON.parse(dataLine.slice('data: '.length))

    expect(parsed).toEqual({ reason: 'session-expired' })
    expect(parsed).not.toHaveProperty('requested')
    expect(parsed).not.toHaveProperty('supported')
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

describe('formatRenewFrame', () => {
  it('produces a correctly structured renew frame', () => {
    const bytes = formatRenewFrame(1, 250)
    const str = decoder.decode(bytes)

    expect(str).toBe('event: renew\ndata: {"reason":"deadline","maxAttempts":1,"retryDelayMs":250}\n\n')
  })

  it('client can parse the renew payload back to its fields', () => {
    const bytes = formatRenewFrame(2, 300)
    const str = decoder.decode(bytes)
    const dataLine = str.split('\n').find((l) => l.startsWith('data:'))!
    const parsed: unknown = JSON.parse(dataLine.slice('data: '.length))

    expect(parsed).toEqual({ reason: 'deadline', maxAttempts: 2, retryDelayMs: 300 })
  })

  it('clamps maxAttempts to a minimum of 1', () => {
    const bytes = formatRenewFrame(0, 250)
    const str = decoder.decode(bytes)
    const dataLine = str.split('\n').find((l) => l.startsWith('data:'))!
    const { maxAttempts }: { maxAttempts: number } = JSON.parse(dataLine.slice('data: '.length))

    expect(maxAttempts).toBe(1)
  })

  it('clamps retryDelayMs to a minimum of 0', () => {
    const bytes = formatRenewFrame(1, -100)
    const str = decoder.decode(bytes)
    const dataLine = str.split('\n').find((l) => l.startsWith('data:'))!
    const { retryDelayMs }: { retryDelayMs: number } = JSON.parse(dataLine.slice('data: '.length))

    expect(retryDelayMs).toBe(0)
  })

  it('floors non-integer maxAttempts', () => {
    const bytes = formatRenewFrame(1.9, 250)
    const str = decoder.decode(bytes)
    const dataLine = str.split('\n').find((l) => l.startsWith('data:'))!
    const { maxAttempts }: { maxAttempts: number } = JSON.parse(dataLine.slice('data: '.length))

    expect(maxAttempts).toBe(1)
  })

  it('always carries reason: deadline', () => {
    const bytes = formatRenewFrame(1, 250)
    const str = decoder.decode(bytes)
    const dataLine = str.split('\n').find((l) => l.startsWith('data:'))!
    const { reason }: { reason: string } = JSON.parse(dataLine.slice('data: '.length))

    expect(reason).toBe('deadline')
  })

  it('event name is renew, not revoke', () => {
    const bytes = formatRenewFrame(1, 250)
    const str = decoder.decode(bytes)

    expect(str).toContain('event: renew')
    expect(str).not.toContain('event: revoke')
  })
})
