/**
 * Appends or updates a query parameter on a URL string while strictly preserving
 * relative path format, protocol-relative origins, search strings, and hash fragments.
 */
export function appendQueryParam(baseUrl: string, key: string, value: string): string {
  const hashIdx = baseUrl.indexOf('#')
  const hash = hashIdx !== -1 ? baseUrl.slice(hashIdx) : ''
  const pathAndSearch = hashIdx !== -1 ? baseUrl.slice(0, hashIdx) : baseUrl
  const queryIdx = pathAndSearch.indexOf('?')
  const pathname = queryIdx !== -1 ? pathAndSearch.slice(0, queryIdx) : pathAndSearch
  const searchStr = queryIdx !== -1 ? pathAndSearch.slice(queryIdx + 1) : ''
  const params = new URLSearchParams(searchStr)
  params.set(key, value)
  const newSearch = params.toString()
  return `${pathname}?${newSearch}${hash}`
}

