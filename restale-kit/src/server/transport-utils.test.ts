import { describe, it, expect } from 'vitest'
import { extractConnectionId, extractLastEventId, extractRequestedTarget } from './transport-utils.js'

describe('transport-utils', () => {
  describe('extractConnectionId', () => {
    it('extracts __restale_cid__ successfully', () => {
      const searchParams = new URLSearchParams('__restale_cid__=conn-12345')
      expect(extractConnectionId(searchParams)).toBe('conn-12345')
    })

    it('throws error when __restale_cid__ query param is missing', () => {
      const searchParams = new URLSearchParams('other=value')
      expect(() => extractConnectionId(searchParams)).toThrow(
        'Missing or invalid __restale_cid__'
      )
    })
  })

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

  describe('extractRequestedTarget', () => {
    it('returns valid SignalTarget when __restale_target__ is a known target value', () => {
      const cases = ['tanstack-query', 'swr', 'rtk-query', 'generic'] as const
      for (const target of cases) {
        const params = new URLSearchParams(`__restale_target__=${target}`)
        expect(extractRequestedTarget(params)).toBe(target)
      }
    })

    it('returns undefined when __restale_target__ param is absent', () => {
      const params = new URLSearchParams('__restale_cid__=abc')
      expect(extractRequestedTarget(params)).toBeUndefined()
    })

    it('returns the raw string when __restale_target__ value is not a known target (so channel can issue unsupported-target revoke)', () => {
      const params = new URLSearchParams('__restale_target__=unknown-framework')
      expect(extractRequestedTarget(params)).toBe('unknown-framework')
    })

    it('returns undefined when __restale_target__ is an empty string', () => {
      const params = new URLSearchParams('__restale_target__=')
      expect(extractRequestedTarget(params)).toBeUndefined()
    })

    it('is case-sensitive — uppercase SWR returns the raw string (not undefined)', () => {
      const params = new URLSearchParams('__restale_target__=SWR')
      // Returns raw string so the channel can reject it via unsupported-target
      expect(extractRequestedTarget(params)).toBe('SWR')
    })
  })
})
