/**
 * Appends or updates a query parameter on a URL string while strictly preserving
 * relative path format, protocol-relative origins, search strings, and hash fragments.
 */
export function appendQueryParam(baseUrl: string, key: string, value: string): string {
  const hashIdx = baseUrl.indexOf('#')
  const hash = hashIdx !== -1 ? baseUrl.slice(hashIdx) : ''
  const pathAndSearch = hashIdx !== -1 ? baseUrl.slice(0, hashIdx) : baseUrl
  const [pathname, search] = pathAndSearch.split('?')
  const params = new URLSearchParams(search || '')
  params.set(key, value)
  const newSearch = params.toString()
  return `${pathname}?${newSearch}${hash}`
}

