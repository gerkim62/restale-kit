'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RestaleProvider } from 'restale-kit/react'
import { tanstackQueryAdapter } from 'restale-kit/tanstack-query'

export function Providers({ children, userId = 'user_1' }: { children: ReactNode; userId?: string }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60,
          },
        },
      }),
  )

  const [onInvalidate] = useState(() => tanstackQueryAdapter(queryClient))

  return (
    <QueryClientProvider client={queryClient}>
      <RestaleProvider url={`/api/sse?userId=${encodeURIComponent(userId)}`} onInvalidate={onInvalidate}>
        {children}
      </RestaleProvider>
    </QueryClientProvider>
  )
}
