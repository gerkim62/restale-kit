import { describe, it, expect } from 'vitest'
import { appendQueryParam } from './url.js'

describe('appendQueryParam', () => {
  it('appends key to simple relative URL', () => {
    expect(appendQueryParam('/sse', 'id', '123')).toBe('/sse?id=123')
  })

  it('appends key to absolute URL', () => {
    expect(appendQueryParam('https://api.example.com/sse', 'id', '456')).toBe(
      'https://api.example.com/sse?id=456'
    )
  })

  it('replaces existing parameter key if already present', () => {
    const result = appendQueryParam('/sse?id=old&theme=dark', 'id', 'new')
    expect(result).toBe('/sse?id=new&theme=dark')
  })

  it('preserves hash fragment at the end of the URL', () => {
    const result = appendQueryParam('/sse?v=1#header', 'id', 'abc')
    expect(result).toBe('/sse?v=1&id=abc#header')
  })

  it('encodes special characters in key and value', () => {
    const result = appendQueryParam('/sse', 'key with spaces', 'a+b/c=')
    expect(result).toBe('/sse?key+with+spaces=a%2Bb%2Fc%3D')
  })
})
