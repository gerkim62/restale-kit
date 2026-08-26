import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'ReStale Kit — Next.js Full Stack Reference',
  description: 'Flagship reference application for restale-kit with TanStack Query and Redis',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans bg-slate-950 text-slate-100 min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
