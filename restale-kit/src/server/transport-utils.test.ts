import { describe, it, expect } from 'vitest'
import { extractLastEventId, buildSSEHeaders } from './transport-utils.js'

describe('transport-utils', () => {
  describe('extractLastEventId', () => {
    it('extracts string header matching lowercase last-event-id', () => {
      const getHeader = (name: string) => (name.toLowerCase() === 'last-event-id' ? 'evt-10' : null)
      expect(extractLastEventId(getHeader)).toBe('evt-10')
    })

    it('extracts string header matching exact Last-Event-ID', () => {
      const getHeader = (name: string) => (name === 'Last-Event-ID' ? 'evt-20' : null)
      expect(extractLastEventId(getHeader)).toBe('evt-20')
    })

    it('handles header returned as array of strings', () => {
      const getHeader = () => ['evt-30', 'evt-40']
      expect(extractLastEventId(getHeader)).toBe('evt-30')
    })

    it('returns undefined if header is missing or empty', () => {
      expect(extractLastEventId(() => undefined)).toBeUndefined()
      expect(extractLastEventId(() => '')).toBeUndefined()
      expect(extractLastEventId(() => [])).toBeUndefined()
    })
  })

  describe('buildSSEHeaders', () => {
    it('returns SSE headers', () => {
      const headers = buildSSEHeaders()
      expect(headers['Content-Type']).toBe('text/event-stream')
      expect(headers['Cache-Control']).toBe('no-cache')
      expect(headers.Connection).toBe('keep-alive')
    })
  })
})
